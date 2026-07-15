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

function normalizeTag(value) {
  return String(value || '').replace(/\\/g, '').trim();
}

function parseSprintNumber(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function computeSprintContext(baseContext, requestedSprint) {
  const baseYear = Number(baseContext?.year) || new Date().getFullYear();
  const baseQuarter = Number(baseContext?.quarter) || 1;
  const baseSprint = Number(baseContext?.sprint) || 1;
  const targetSprint = Number(requestedSprint) || baseSprint;

  let targetYear = baseYear;
  let targetQuarter = baseQuarter;

  if (targetSprint < baseSprint) {
    targetQuarter += 1;
    if (targetQuarter > 4) {
      targetQuarter = 1;
      targetYear += 1;
    }
  }

  return {
    year: targetYear,
    quarter: targetQuarter,
    sprint: targetSprint
  };
}

function buildIterationPath(baseIterationPath, sprintContext) {
  // Si hay baseIterationPath válido del nodo seleccionado, úsalo directamente
  // El path ya viene en formato correcto: "Gerencia_Tecnologia\2026 [11 días hábiles]\Sprint 5 Q2 2026"
  const raw = String(baseIterationPath || '').trim();
  if (raw) {
    return raw;
  }
  
  // Solo si no hay baseIterationPath, devuelve vacío (será opcional)
  return '';
}

function toHtmlParagraphs(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return '';
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('');
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

async function createWorkItem(typeName, operations) {
  const projectName = encodeURIComponent(String(process.env.AZURE_PROJECT_NAME || '').trim());
  const workItemType = String(typeName || 'Task').trim() || 'Task';
  const relativePath = `/${projectName}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.1`;

  return azdoRequest(relativePath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json-patch+json'
    },
    body: JSON.stringify(operations)
  });
}

// Intenta crear con Task, si falla con VS403074, reintenta con Tarea
async function createWorkItemWithFallback(primaryType, fallbackType, operations) {
  try {
    return await createWorkItem(primaryType, operations);
  } catch (error) {
    const errorMsg = String(error.message || '');
    if (errorMsg.includes('VS403074')) {
      console.log(`${primaryType} está bloqueado, intentando con ${fallbackType}...`);
      return await createWorkItem(fallbackType, operations);
    }
    throw error;
  }
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

app.post('/api/workitems/create-task', async (req, res) => {
  try {
    const missing = getMissingEnv();
    if (missing.length) {
      return res.status(500).json({
        error: `Faltan variables de entorno: ${missing.join(', ')}`
      });
    }

    const parentId = Number(req.body?.parentId);
    const title = String(req.body?.title || '').trim();
    const assignedTo = String(req.body?.assignedTo || '').trim();
    const description = String(req.body?.description || '').trim();
    const acceptance = String(req.body?.acceptanceCriteria || '').trim();
    const quarterTag = normalizeTag(req.body?.quarterTag);
    const cellTag = normalizeTag(req.body?.cellTag);
    const effort = Number(req.body?.effort);
    const createSubtask = Boolean(req.body?.createSubtask);
    const subtaskInitialEstimate = Number(req.body?.subtaskInitialEstimate);

    const baseIterationPath = String(req.body?.selectedContext?.iterationPath || '').trim();
    const baseAreaPath = String(req.body?.selectedContext?.areaPath || '').trim();
    const baseYear = Number(req.body?.selectedContext?.year);
    const baseQuarter = Number(req.body?.selectedContext?.quarter);
    const baseSprint = Number(req.body?.selectedContext?.sprint);
    const requestedSprint = parseSprintNumber(req.body?.sprint);

    if (!Number.isInteger(parentId) || parentId <= 0) {
      return res.status(400).json({ error: 'parentId es requerido.' });
    }

    if (!title) {
      return res.status(400).json({ error: 'El titulo es requerido.' });
    }

    const sprintContext = computeSprintContext(
      {
        year: baseYear,
        quarter: baseQuarter,
        sprint: baseSprint
      },
      requestedSprint
    );

    const computedIterationPath = buildIterationPath(baseIterationPath, sprintContext);
    const tags = [quarterTag, cellTag].filter(Boolean).join('; ');

    const taskOps = [
      { op: 'add', path: '/fields/System.Title', value: title },
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${String(process.env.AZURE_ORGANIZATION_URL || '').replace(/\/$/, '')}/_apis/wit/workItems/${parentId}`,
          attributes: {
            comment: 'Creada desde Azure Boards Web'
          }
        }
      },
      // Campo personalizado: Tipo de tarea = Tarea
      { op: 'add', path: '/fields/custom.Tipodetarea', value: 'Tarea' }
    ];

    // Agregar AreaPath del padre si está disponible
    if (baseAreaPath) {
      taskOps.push({ op: 'add', path: '/fields/System.AreaPath', value: baseAreaPath });
    }

    if (description) {
      const htmlDescription = toHtmlParagraphs(description);
      if (htmlDescription) {
        taskOps.push({ op: 'add', path: '/fields/System.Description', value: htmlDescription });
      }
    }
    if (acceptance) {
      const htmlAcceptance = toHtmlParagraphs(acceptance);
      if (htmlAcceptance) {
        taskOps.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: htmlAcceptance });
      }
    }

    if (assignedTo) taskOps.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo });
    // Solo agregar IterationPath si tiene estructura completa (contiene "Sprint")
    if (computedIterationPath && computedIterationPath.includes('Sprint')) {
      taskOps.push({ op: 'add', path: '/fields/System.IterationPath', value: computedIterationPath });
    }
    if (tags) taskOps.push({ op: 'add', path: '/fields/System.Tags', value: tags });
    if (!Number.isNaN(effort) && effort > 0) taskOps.push({ op: 'add', path: '/fields/Custom.PuntosdeEsfuerzo', value: effort });

    // Intenta Tarea primero (tipo obligatorio en tu Azure DevOps)
    const createdTask = await createWorkItemWithFallback('Tarea', 'Task', taskOps);
    const responsePayload = {
      taskId: createdTask.id
    };

    if (createSubtask) {
      const resolvedSubtaskEstimate = !Number.isNaN(subtaskInitialEstimate) && subtaskInitialEstimate > 0
        ? subtaskInitialEstimate
        : 3;

      const subtaskOps = [
        { op: 'add', path: '/fields/System.Title', value: title },
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: `${String(process.env.AZURE_ORGANIZATION_URL || '').replace(/\/$/, '')}/_apis/wit/workItems/${createdTask.id}`,
            attributes: {
              comment: 'Creada desde Azure Boards Web'
            }
          }
        },
        { op: 'add', path: '/fields/Custom.c12a8be8-c31b-42ad-b201-0b64e1f59cea', value: resolvedSubtaskEstimate },
        { op: 'add', path: '/fields/Custom.Tipodesubtarea', value: 'Subtarea' }
      ];

      // Agregar AreaPath del padre si está disponible
      if (baseAreaPath) {
        subtaskOps.push({ op: 'add', path: '/fields/System.AreaPath', value: baseAreaPath });
      }

      if (assignedTo) subtaskOps.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo });
      if (computedIterationPath && computedIterationPath.includes('Sprint')) {
        subtaskOps.push({ op: 'add', path: '/fields/System.IterationPath', value: computedIterationPath });
      }
      if (tags) subtaskOps.push({ op: 'add', path: '/fields/System.Tags', value: tags });

      // Intenta Subtarea primero
      const createdSubtask = await createWorkItemWithFallback('Subtarea', 'Subtask', subtaskOps);
      responsePayload.subtaskId = createdSubtask.id;
    }

    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error interno al crear tarea.' });
  }
});

app.listen(PORT, () => {
  console.log(`Azure Boards Web disponible en http://localhost:${PORT}`);
});
