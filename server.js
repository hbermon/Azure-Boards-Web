const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const REQUIRED_ENV = [
  'AZURE_ORGANIZATION_URL',
  'AZURE_PROJECT_NAME',
  'AZURE_PERSONAL_ACCESS_TOKEN'
];

function getMissingEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function parseIds(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);
}

function getDefaultBacklogName() {
  if (process.env.AZURE_BACKLOG_NAME) {
    return process.env.AZURE_BACKLOG_NAME.trim();
  }

  const areaPath = String(process.env.AZURE_AREA_PATH || '').trim();
  if (!areaPath) return '';

  const parts = areaPath.split('\\').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function getDefaultRoots() {
  return parseIds(process.env.AZURE_ROOT_PROYECTOS);
}

function toAzdoChildIds(workItem) {
  const relations = Array.isArray(workItem.relations) ? workItem.relations : [];
  return relations
    .filter((rel) => rel && rel.rel === 'System.LinkTypes.Hierarchy-Forward' && typeof rel.url === 'string')
    .map((rel) => {
      const match = rel.url.match(/workItems\/(\d+)$/i);
      return match ? Number(match[1]) : null;
    })
    .filter((id) => Number.isInteger(id));
}

function extractCellTag(tagsRaw) {
  const tags = String(tagsRaw || '')
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return tags.find((tag) => tag.toUpperCase().includes('[ARQ]')) || '';
}

function extractSprint(iterationPath) {
  const value = String(iterationPath || '').trim();
  if (!value) return '';
  const parts = value.split('\\').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || value;
}

function buildAuthHeaders() {
  const token = process.env.AZURE_PERSONAL_ACCESS_TOKEN;
  const encoded = Buffer.from(`:${token}`).toString('base64');
  return {
    Authorization: `Basic ${encoded}`,
    'Content-Type': 'application/json'
  };
}

async function azdoRequest(relativePath, options = {}) {
  const base = String(process.env.AZURE_ORGANIZATION_URL || '').replace(/\/$/, '');
  const url = `${base}${relativePath}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...buildAuthHeaders(),
      ...(options.headers || {})
    },
    body: options.body
  });

  if (!response.ok) {
    const text = await response.text();
    const details = text.length > 800 ? `${text.slice(0, 800)}...` : text;
    throw new Error(`Azure DevOps API error ${response.status}: ${details}`);
  }

  return response.json();
}

async function fetchWorkItemsBatch(ids) {
  if (!ids.length) return [];

  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }

  const all = [];
  for (const chunk of chunks) {
    const relationResult = await azdoRequest('/_apis/wit/workitemsbatch?api-version=7.1', {
      method: 'POST',
      body: JSON.stringify({
        ids: chunk,
        errorPolicy: 'Omit',
        $expand: 'Relations'
      })
    });

    const fieldsResult = await azdoRequest('/_apis/wit/workitemsbatch?api-version=7.1', {
      method: 'POST',
      body: JSON.stringify({
        ids: chunk,
        errorPolicy: 'Omit',
        fields: [
          'System.Id',
          'System.Title',
          'System.WorkItemType',
          'System.State',
          'System.AreaPath',
          'System.IterationPath',
          'System.Tags',
          'System.AssignedTo'
        ]
      })
    });

    const relationItems = Array.isArray(relationResult.value) ? relationResult.value : [];
    const fieldItems = Array.isArray(fieldsResult.value) ? fieldsResult.value : [];
    const fieldMap = new Map(
      fieldItems
        .filter((item) => item && Number.isInteger(item.id))
        .map((item) => [item.id, item.fields || {}])
    );

    for (const item of relationItems) {
      if (!item || !Number.isInteger(item.id)) continue;
      const mergedFields = {
        ...(item.fields || {}),
        ...(fieldMap.get(item.id) || {})
      };
      all.push({
        ...item,
        fields: mergedFields
      });
    }
  }

  return all;
}

async function loadHierarchyFromRoots(rootIds, backlogName) {
  const seen = new Set();
  const queue = [...rootIds];
  const map = new Map();

  while (queue.length) {
    const batch = queue.splice(0, 200).filter((id) => !seen.has(id));
    if (!batch.length) continue;

    batch.forEach((id) => seen.add(id));
    const items = await fetchWorkItemsBatch(batch);

    for (const item of items) {
      if (!item || !item.id) continue;
      map.set(item.id, item);

      const childIds = toAzdoChildIds(item);
      for (const childId of childIds) {
        if (!seen.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  const areaPathPrefix = String(process.env.AZURE_AREA_PATH_PREFIX || '').trim();

  function includeByBacklog(item) {
    const area = String(item.fields?.['System.AreaPath'] || '');

    if (!backlogName && !areaPathPrefix) return true;
    if (areaPathPrefix && !area.startsWith(areaPathPrefix)) return false;
    if (backlogName && !area.toLowerCase().includes(backlogName.toLowerCase())) return false;

    return true;
  }

  function toNode(id, depth, chain) {
    const item = map.get(id);
    if (!item) return null;
    if (chain.has(id)) return null;

    const nextChain = new Set(chain);
    nextChain.add(id);

    const children = toAzdoChildIds(item)
      .map((childId) => toNode(childId, depth + 1, nextChain))
      .filter(Boolean);

    const passesFilter = includeByBacklog(item);
    const hasPassingChild = children.length > 0;
    if (!passesFilter && !hasPassingChild) {
      return null;
    }

    return {
      id: item.id,
      title: item.fields?.['System.Title'] || `(Sin titulo ${item.id})`,
      workItemType: item.fields?.['System.WorkItemType'] || 'Desconocido',
      state: item.fields?.['System.State'] || 'Sin estado',
      areaPath: item.fields?.['System.AreaPath'] || '',
      iterationPath: item.fields?.['System.IterationPath'] || '',
      sprint: extractSprint(item.fields?.['System.IterationPath']),
      tags: item.fields?.['System.Tags'] || '',
      cellTag: extractCellTag(item.fields?.['System.Tags']),
      assignedTo: item.fields?.['System.AssignedTo']?.displayName || 'Sin asignar',
      depth,
      children
    };
  }

  return rootIds
    .map((id) => toNode(id, 0, new Set()))
    .filter(Boolean);
}

app.get('/api/config', async (req, res) => {
  try {
    const missing = getMissingEnv();
    if (missing.length) {
      return res.status(500).json({
        error: `Faltan variables de entorno: ${missing.join(', ')}`
      });
    }

    const defaultBacklogName = getDefaultBacklogName();
    const defaultRootIds = getDefaultRoots();
    const rootItems = await fetchWorkItemsBatch(defaultRootIds);
    const rootMap = new Map(
      rootItems
        .filter((item) => item && Number.isInteger(item.id))
        .map((item) => [item.id, item])
    );

    const roots = defaultRootIds.map((id) => {
      const item = rootMap.get(id);
      return {
        id,
        title: item?.fields?.['System.Title'] || `Proyecto ${id} (sin acceso o no encontrado)`
      };
    });

    res.json({
      defaultBacklogName,
      defaultRootIds,
      roots
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

app.get('/api/hierarchy', async (req, res) => {
  try {
    const missing = getMissingEnv();
    if (missing.length) {
      return res.status(500).json({
        error: `Faltan variables de entorno: ${missing.join(', ')}`
      });
    }

    const backlogName = String(req.query.backlogName || getDefaultBacklogName()).trim();
    const rootIds = parseIds(req.query.rootIds || process.env.AZURE_ROOT_PROYECTOS);

    if (!rootIds.length) {
      return res.status(400).json({
        error: 'No hay IDs de proyectos raiz para consultar.'
      });
    }

    const tree = await loadHierarchyFromRoots(rootIds, backlogName);

    res.json({
      backlogName,
      rootIds,
      tree
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

app.listen(PORT, () => {
  console.log(`Azure Boards Web disponible en http://localhost:${PORT}`);
});
