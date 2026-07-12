const controlsForm = document.getElementById('controls');
const backlogInput = document.getElementById('backlogName');
const projectSelector = document.getElementById('projectSelector');
const treeContainer = document.getElementById('treeContainer');
const statusText = document.getElementById('statusText');
const selectedWorkItemTitle = document.getElementById('selectedWorkItemTitle');
const selectedWorkItemMeta = document.getElementById('selectedWorkItemMeta');
const detailSprint = document.getElementById('detailSprint');
const detailAssigned = document.getElementById('detailAssigned');
const detailCell = document.getElementById('detailCell');
const filterTextInput = document.getElementById('filterTextInput');
const filterSprintSelect = document.getElementById('filterSprintSelect');
const filterAssignedSelect = document.getElementById('filterAssignedSelect');
const filterCellSelect = document.getElementById('filterCellSelect');
const btnClearFilters = document.getElementById('btnClearFilters');
const legendCounters = [0, 1, 2, 3, 4].map((depth) => document.getElementById(`legendCount${depth}`));
const legendButtons = Array.from(document.querySelectorAll('.legend-entry[data-depth]'));

const LEVEL_NAMES = ['Proyecto', 'Epica', 'Feature', 'Tarea', 'Subtarea'];

let knownRoots = [];
let originalTree = [];
let selectedNodeId = null;
let selectedNodeData = null;
let collapsedNodeIds = new Set();
let activeFilters = {
  text: null,
  sprint: null,
  assignedTo: null,
  cell: null
};

function setStatus(text) {
  statusText.textContent = text;
}

function setError(message) {
  treeContainer.innerHTML = `<p class="error">${message}</p>`;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getNodeSprint(node) {
  const raw = String(node.iterationPath || node.sprint || '').trim();
  if (!raw) return '';

  const yearMatch = raw.match(/\b(20\d{2})\b/);
  const sprintMatch = raw.match(/sprint\s*([0-9]+)/i);
  const quarterFromQorT = raw.match(/\b[QqTt]\s*([1-4])\b/);
  const quarterFromWord = raw.match(/trimestre\s*([1-4])/i);
  const quarterValue = quarterFromQorT?.[1] || quarterFromWord?.[1] || '';

  const year = yearMatch?.[1] || '';
  const quarter = quarterValue ? `Q${quarterValue}` : '';
  const sprint = sprintMatch?.[1] ? `Sprint ${sprintMatch[1]}` : '';

  const formatted = [year, quarter, sprint].filter(Boolean).join(' ').trim();
  return formatted;
}

function getNodeAssigned(node) {
  return String(node.assignedTo || '').trim();
}

function getNodeCell(node) {
  return String(node.cellTag || '').trim();
}

function getStateClass(state) {
  const normalized = normalizeText(state);
  if (normalized.includes('cerrado')) return 'state-closed';
  if (normalized.includes('en progreso')) return 'state-in-progress';
  if (normalized.includes('impedimento')) return 'state-blocked';
  return '';
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function fillSelect(selectElement, values, allLabel, selectedValue) {
  selectElement.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = allLabel;
  selectElement.appendChild(allOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });

  selectElement.value = values.includes(selectedValue) ? selectedValue : '';
}

function populateFilterSelects(tree) {
  const allNodes = flattenNodes(tree, []);
  const sprints = uniqueSorted(allNodes.map((node) => getNodeSprint(node)).filter(Boolean));
  const assignees = uniqueSorted(
    allNodes
      .map((node) => getNodeAssigned(node))
      .filter((value) => value && value !== 'Sin asignar')
  );
  const cells = uniqueSorted(allNodes.map((node) => getNodeCell(node)));

  fillSelect(filterSprintSelect, sprints, 'Todos los sprints', activeFilters.sprint || '');
  fillSelect(filterAssignedSelect, assignees, 'Todos los asignados', activeFilters.assignedTo || '');
  fillSelect(filterCellSelect, cells, 'Todas las celulas', activeFilters.cell || '');
}

function updateDetailPanel(node) {
  if (!node) {
    selectedWorkItemTitle.textContent = 'Selecciona un work item del arbol';
    selectedWorkItemMeta.textContent = 'Sin seleccion';
    detailSprint.textContent = '-';
    detailAssigned.textContent = '-';
    detailCell.textContent = '-';
    return;
  }

  selectedWorkItemTitle.textContent = `${node.id} - ${node.title}`;
  selectedWorkItemMeta.innerHTML = '';

  const typeBadge = document.createElement('span');
  typeBadge.className = `detail-badge detail-type node-depth-${Math.min(node.depth, 4)}`;
  typeBadge.textContent = node.workItemType;

  const stateBadge = document.createElement('span');
  stateBadge.className = 'detail-badge detail-state';
  const stateClass = getStateClass(node.state);
  if (stateClass) {
    stateBadge.classList.add(stateClass);
  }
  stateBadge.textContent = node.state;

  selectedWorkItemMeta.appendChild(typeBadge);
  selectedWorkItemMeta.appendChild(stateBadge);
  detailSprint.textContent = getNodeSprint(node) || 'Sin sprint';
  detailAssigned.textContent = getNodeAssigned(node) || 'Sin asignado';
  detailCell.textContent = getNodeCell(node) || 'Sin celula [ARQ]';
}

function flattenNodes(tree, target = []) {
  tree.forEach((node) => {
    target.push(node);
    flattenNodes(node.children || [], target);
  });
  return target;
}

function findNodeById(tree, id) {
  if (!id) return null;
  const all = flattenNodes(tree, []);
  return all.find((node) => node.id === id) || null;
}

function nodeMatchesActiveFilters(node) {
  const query = normalizeText(activeFilters.text);
  const searchable = `${node.id} ${node.title}`;
  const textMatch = !query || normalizeText(searchable).includes(query);
  const sprintMatch = !activeFilters.sprint || normalizeText(getNodeSprint(node)).includes(normalizeText(activeFilters.sprint));
  const assignedMatch = !activeFilters.assignedTo || normalizeText(getNodeAssigned(node)) === normalizeText(activeFilters.assignedTo);
  const cellMatch = !activeFilters.cell || normalizeText(getNodeCell(node)) === normalizeText(activeFilters.cell);
  return textMatch && sprintMatch && assignedMatch && cellMatch;
}

function hasActiveFilters() {
  return Boolean(activeFilters.text || activeFilters.sprint || activeFilters.assignedTo || activeFilters.cell);
}

function updateLegendCounters() {
  const counts = [0, 0, 0, 0, 0];
  const allNodes = flattenNodes(originalTree, []);
  const shouldUseFilterRule = hasActiveFilters();

  allNodes.forEach((node) => {
    const depth = Math.min(Number(node.depth) || 0, 4);
    const canCount = shouldUseFilterRule ? nodeMatchesActiveFilters(node) : true;
    if (canCount) {
      counts[depth] += 1;
    }
  });

  legendCounters.forEach((element, depth) => {
    if (element) {
      element.textContent = String(counts[depth]);
    }
  });
}

function filterTreeKeepingParents(nodes) {
  return nodes
    .map((node) => {
      const filteredChildren = filterTreeKeepingParents(node.children || []);
      const selfMatch = nodeMatchesActiveFilters(node);

      if (!selfMatch && filteredChildren.length === 0) {
        return null;
      }

      return {
        ...node,
        children: filteredChildren
      };
    })
    .filter(Boolean);
}

function initializeCollapsedFromFeature(tree) {
  const allNodes = flattenNodes(tree, []);
  collapsedNodeIds = new Set(
    allNodes
      .filter((node) => Number(node.depth) >= 2 && Array.isArray(node.children) && node.children.length > 0)
      .map((node) => node.id)
  );
}

function collapseTreeUpToLevel(depthLimit) {
  const numericDepthLimit = Number(depthLimit);
  const allNodes = flattenNodes(originalTree, []);
  collapsedNodeIds = new Set(
    allNodes
      .filter((node) => Number(node.depth) >= numericDepthLimit && Array.isArray(node.children) && node.children.length > 0)
      .map((node) => node.id)
  );
  applyActiveFiltersAndRender();
}

function applyActiveFiltersAndRender() {
  const filteredTree = filterTreeKeepingParents(originalTree);
  renderTree(filteredTree);
  updateLegendCounters();

  const activeSummary = [
    activeFilters.text ? `Texto: ${activeFilters.text}` : null,
    activeFilters.sprint ? `Sprint: ${activeFilters.sprint}` : null,
    activeFilters.assignedTo ? `Asignado: ${activeFilters.assignedTo}` : null,
    activeFilters.cell ? `Celula: ${activeFilters.cell}` : null
  ].filter(Boolean);

  if (activeSummary.length) {
    setStatus(`Filtros activos -> ${activeSummary.join(' | ')}`);
  }
}

function syncSelectedNodeFromOriginalTree() {
  selectedNodeData = findNodeById(originalTree, selectedNodeId);
  updateDetailPanel(selectedNodeData);
}

function selectedRootIds() {
  return Array.from(projectSelector.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => Number(input.value))
    .filter((id) => Number.isInteger(id));
}

function createRootSelector(roots, preselected = []) {
  knownRoots = roots;
  projectSelector.innerHTML = '';

  roots.forEach((root) => {
    const label = document.createElement('label');
    label.className = 'project-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(root.id);
    checkbox.checked = preselected.includes(root.id);

    const text = document.createElement('span');
    text.textContent = `${root.id} - ${root.title}`;

    label.appendChild(checkbox);
    label.appendChild(text);
    projectSelector.appendChild(label);
  });
}

function createNodeElement(node) {
  const template = document.getElementById('treeNodeTemplate');
  const fragment = template.content.cloneNode(true);
  const li = fragment.querySelector('.tree-node');
  const pill = fragment.querySelector('.node-pill');
  const childList = fragment.querySelector('.children');
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const level = document.createElement('span');
  level.className = 'node-level';
  level.textContent = LEVEL_NAMES[node.depth] || `Nivel ${node.depth + 1}`;

  const title = document.createElement('span');
  title.className = 'node-title';
  title.textContent = `${node.id} - ${node.title}`;

  const assigned = document.createElement('span');
  assigned.className = 'node-assigned';
  assigned.textContent = `(${getNodeAssigned(node) || 'Sin asignar'})`;

  const meta = document.createElement('span');
  meta.className = 'node-meta';
  meta.textContent = node.state;
  const stateClass = getStateClass(node.state);
  if (stateClass) {
    meta.classList.add(stateClass);
  }

  const icon = document.createElement('span');
  icon.className = 'node-icon';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'node-toggle';

  if (hasChildren) {
    const isCollapsed = collapsedNodeIds.has(node.id);
    toggle.textContent = isCollapsed ? '▸' : '▾';
    toggle.setAttribute('aria-label', isCollapsed ? 'Expandir nodo' : 'Colapsar nodo');
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (collapsedNodeIds.has(node.id)) {
        collapsedNodeIds.delete(node.id);
      } else {
        collapsedNodeIds.add(node.id);
      }
      applyActiveFiltersAndRender();
    });
  } else {
    toggle.textContent = '·';
    toggle.classList.add('is-empty');
    toggle.setAttribute('aria-hidden', 'true');
    toggle.disabled = true;
  }

  const depthClass = `node-depth-${Math.min(node.depth, 4)}`;
  pill.classList.add(depthClass);

  if (node.id === selectedNodeId) {
    pill.classList.add('is-selected');
  }

  pill.addEventListener('click', () => {
    selectedNodeId = node.id;
    selectedNodeData = node;
    updateDetailPanel(node);
    applyActiveFiltersAndRender();
  });

  pill.appendChild(toggle);
  pill.appendChild(icon);
  pill.appendChild(level);
  pill.appendChild(title);
  pill.appendChild(assigned);
  pill.appendChild(meta);

  if (!hasChildren || collapsedNodeIds.has(node.id)) {
    childList.remove();
  } else {
    node.children.forEach((child) => {
      childList.appendChild(createNodeElement(child));
    });
  }

  return li;
}

function renderTree(tree) {
  treeContainer.innerHTML = '';

  if (!tree.length) {
    treeContainer.innerHTML = '<p>No se encontraron work items para los filtros seleccionados.</p>';
    return;
  }

  const rootList = document.createElement('ul');
  rootList.className = 'tree-root';

  tree.forEach((rootNode) => {
    rootList.appendChild(createNodeElement(rootNode));
  });

  treeContainer.appendChild(rootList);
}

async function loadConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || 'No se pudo cargar la configuracion.');
  }

  return response.json();
}

async function loadHierarchy() {
  const selected = selectedRootIds();
  if (!selected.length) {
    setError('Selecciona al menos un proyecto raiz para visualizar.');
    return;
  }

  const backlogName = backlogInput.value.trim();
  const params = new URLSearchParams({
    backlogName,
    rootIds: selected.join(',')
  });

  setStatus('Consultando Azure Boards...');

  const response = await fetch(`/api/hierarchy?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Error al consultar la jerarquia.');
  }

  originalTree = payload.tree || [];
  initializeCollapsedFromFeature(originalTree);
  populateFilterSelects(originalTree);

  if (selectedNodeId) {
    syncSelectedNodeFromOriginalTree();
  }

  applyActiveFiltersAndRender();

  if (!activeFilters.text && !activeFilters.sprint && !activeFilters.assignedTo && !activeFilters.cell) {
    setStatus(`Mostrando ${selected.length} proyecto(s) en backlog ${payload.backlogName || '(sin nombre)'}`);
  }
}

filterTextInput.addEventListener('input', () => {
  const value = filterTextInput.value.trim();
  activeFilters.text = value || null;
  applyActiveFiltersAndRender();
});

filterSprintSelect.addEventListener('change', () => {
  activeFilters.sprint = filterSprintSelect.value || null;
  applyActiveFiltersAndRender();
});

filterAssignedSelect.addEventListener('change', () => {
  activeFilters.assignedTo = filterAssignedSelect.value || null;
  applyActiveFiltersAndRender();
});

filterCellSelect.addEventListener('change', () => {
  activeFilters.cell = filterCellSelect.value || null;
  applyActiveFiltersAndRender();
});

btnClearFilters.addEventListener('click', () => {
  activeFilters = {
    text: null,
    sprint: null,
    assignedTo: null,
    cell: null
  };
  filterTextInput.value = '';
  filterSprintSelect.value = '';
  filterAssignedSelect.value = '';
  filterCellSelect.value = '';
  applyActiveFiltersAndRender();
  setStatus('Filtros limpiados.');
});

legendButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const depth = button.dataset.depth;
    collapseTreeUpToLevel(depth);
  });
});

controlsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadHierarchy();
  } catch (error) {
    setError(error.message || 'Error inesperado.');
    setStatus('Error al cargar');
  }
});

(async function init() {
  try {
    setStatus('Cargando configuracion...');
    const config = await loadConfig();

    backlogInput.value = config.defaultBacklogName || '';
    createRootSelector(config.roots || [], config.defaultRootIds || []);
    updateDetailPanel(null);

    await loadHierarchy();
  } catch (error) {
    setError(error.message || 'No se pudo inicializar la aplicacion.');
    setStatus('Error de inicializacion');
  }
})();
