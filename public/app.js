const controlsForm = document.getElementById('controls');
const backlogInput = document.getElementById('backlogName');
const backlogSelector = document.getElementById('backlogSelector');
const btnChangeBacklog = document.getElementById('btnChangeBacklog');
const projectSelector = document.getElementById('projectSelector');
const newProjectIdInput = document.getElementById('newProjectId');
const btnAddProject = document.getElementById('btnAddProject');
const treeContainer = document.getElementById('treeContainer');
const statusText = document.getElementById('statusText');
const selectedWorkItemTitle = document.getElementById('selectedWorkItemTitle');
const selectedWorkItemMeta = document.getElementById('selectedWorkItemMeta');
const detailActionButtons = document.getElementById('detailActionButtons');
const btnCreateSameType = document.getElementById('btnCreateSameType');
const btnCreateChild = document.getElementById('btnCreateChild');
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
const taskModal = document.getElementById('taskModal');
const btnCloseTaskModal = document.getElementById('btnCloseTaskModal');
const tabRawText = document.getElementById('tabRawText');
const tabFieldByField = document.getElementById('tabFieldByField');
const panelRawText = document.getElementById('panelRawText');
const panelFieldByField = document.getElementById('panelFieldByField');
const taskModalTitle = document.getElementById('taskModalTitle');
const rawTaskText = document.getElementById('rawTaskText');
const fieldTitle = document.getElementById('fieldTitle');
const fieldAssigned = document.getElementById('fieldAssigned');
const fieldSprint = document.getElementById('fieldSprint');
const fieldQuarterTag = document.getElementById('fieldQuarterTag');
const fieldCellTag = document.getElementById('fieldCellTag');
const fieldEffort = document.getElementById('fieldEffort');
const fieldDescription = document.getElementById('fieldDescription');
const fieldAcceptance = document.getElementById('fieldAcceptance');
const chkCreateSubtask = document.getElementById('chkCreateSubtask');
const subtaskEstimateRawWrap = document.getElementById('subtaskEstimateRawWrap');
const subtaskEstimateFieldWrap = document.getElementById('subtaskEstimateFieldWrap');
const subtaskEstimateRaw = document.getElementById('subtaskEstimateRaw');
const subtaskEstimateField = document.getElementById('subtaskEstimateField');
const btnSubmitCreateTask = document.getElementById('btnSubmitCreateTask');
const resultModal = document.getElementById('resultModal');
const btnCloseResultModal = document.getElementById('btnCloseResultModal');
const resultContent = document.getElementById('resultContent');

const LEVEL_NAMES = ['Proyecto', 'Epica', 'Feature', 'Tarea', 'Subtarea'];
const STORAGE_REMOVED_PROJECTS_KEY = 'azureBoardsWeb.removedProjects';
const STORAGE_ADDED_PROJECTS_KEY = 'azureBoardsWeb.addedProjects';
const STORAGE_BACKLOG_OPTIONS_KEY = 'azureBoardsWeb.backlogOptions';

let knownRoots = [];
let systemRoots = [];
let customRoots = [];
let removedProjectIds = new Set();
let originalTree = [];
let selectedNodeId = null;
let selectedNodeData = null;
let collapsedNodeIds = new Set();
let pendingCreateContext = null;
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

function loadArrayFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveArrayToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadProjectPreferences() {
  const removedIds = loadArrayFromStorage(STORAGE_REMOVED_PROJECTS_KEY)
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  const added = loadArrayFromStorage(STORAGE_ADDED_PROJECTS_KEY)
    .map((item) => ({
      id: Number(item?.id),
      title: String(item?.title || '').trim()
    }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0);

  removedProjectIds = new Set(removedIds);
  customRoots = added;
}

function loadBacklogOptions(defaultBacklogName) {
  const stored = loadArrayFromStorage(STORAGE_BACKLOG_OPTIONS_KEY)
    .map((name) => String(name || '').trim())
    .filter(Boolean);

  const merged = uniqueSorted([defaultBacklogName, ...stored].filter(Boolean));
  saveArrayToStorage(STORAGE_BACKLOG_OPTIONS_KEY, merged);
  return merged;
}

function saveBacklogOption(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return;

  const existing = loadArrayFromStorage(STORAGE_BACKLOG_OPTIONS_KEY)
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  const merged = uniqueSorted([...existing, normalized]);
  saveArrayToStorage(STORAGE_BACKLOG_OPTIONS_KEY, merged);
}

function renderBacklogOptions(options, selectedValue = '') {
  backlogSelector.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Seleccionar backlog...';
  backlogSelector.appendChild(placeholder);

  options.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    backlogSelector.appendChild(option);
  });

  backlogSelector.value = options.includes(selectedValue) ? selectedValue : '';
}

function saveProjectPreferences() {
  saveArrayToStorage(STORAGE_REMOVED_PROJECTS_KEY, Array.from(removedProjectIds));
  saveArrayToStorage(STORAGE_ADDED_PROJECTS_KEY, customRoots);
}

function recomputeKnownRoots() {
  const mergedMap = new Map();

  systemRoots.forEach((root) => {
    mergedMap.set(root.id, root);
  });

  customRoots.forEach((root) => {
    if (!mergedMap.has(root.id)) {
      mergedMap.set(root.id, root);
    }
  });

  knownRoots = Array.from(mergedMap.values()).filter((root) => !removedProjectIds.has(root.id));
}

function removeProjectFromAvailable(id) {
  removedProjectIds.add(id);
  customRoots = customRoots.filter((root) => root.id !== id);
  saveProjectPreferences();

  const currentlySelected = new Set(selectedRootIds());
  currentlySelected.delete(id);

  recomputeKnownRoots();
  createRootSelector(knownRoots, Array.from(currentlySelected));
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

function parseYearQuarterSprint(value) {
  const raw = String(value || '').trim();
  const year = Number((raw.match(/\b(20\d{2})\b/) || [])[1]);
  const quarter = Number((raw.match(/\bQ\s*([1-4])\b/i) || [])[1]);
  const sprint = Number((raw.match(/Sprint\s*([0-9]+)/i) || [])[1]);
  return {
    year: Number.isInteger(year) ? year : null,
    quarter: Number.isInteger(quarter) ? quarter : null,
    sprint: Number.isInteger(sprint) ? sprint : null
  };
}

function findLineValue(lines, labelRegex) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(labelRegex);
    if (!match) continue;

    let value = (match[1] || '').trim();
    if (value) return value;

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/:\s*$/.test(next)) continue;
      if (/^\*\*?[A-Za-zÁÉÍÓÚáéíóúñÑ\[\] ]+\*\*?\s*:/.test(next)) break;
      return next.replace(/^[-*]\s*/, '').trim();
    }
  }
  return '';
}

function extractSection(text, startRegex, endRegex) {
  const source = String(text || '');
  const startMatch = source.match(startRegex);
  if (!startMatch || startMatch.index == null) return '';
  const startIndex = startMatch.index + startMatch[0].length;
  const rest = source.slice(startIndex);
  const endMatch = rest.match(endRegex);
  const chunk = endMatch && endMatch.index != null ? rest.slice(0, endMatch.index) : rest;
  return chunk.trim();
}

function parseTaskFromRawText(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');

  const title = findLineValue(lines, /\*\*\s*T[ií]tulo\s*:\s*\*\*\s*(.*)$/i);
  const assignedTo = findLineValue(lines, /\*\*\s*Asignado\s*:\s*\*\*\s*(.*)$/i);
  const sprint = findLineValue(lines, /\*\*\s*Sprint\s*:\s*\*\*\s*(.*)$/i);
  const quarterTag = findLineValue(lines, /\*\*\s*Trimestre\s*:\s*\*\*\s*(.*)$/i);
  const cellTag = findLineValue(lines, /\*\*\s*C[eé]lula\s*:\s*\*\*\s*(.*)$/i).replace(/\\/g, '');
  const effort = findLineValue(lines, /\*\*\s*Puntos\s+de\s+Esfuerzo\s*:\s*\*\*\s*(.*)$/i);

  const description = extractSection(
    source,
    /###\s*\*\*?Descripci[oó]n\*\*?\s*/i,
    /###\s*✅?\s*\*\*?Criterios\s+de\s+aceptaci[oó]n\*\*?/i
  );

  const acceptanceCriteria = extractSection(
    source,
    /###\s*✅?\s*\*\*?Criterios\s+de\s+aceptaci[oó]n\*\*?/i,
    /^\*\*\*\s*$/im
  );

  return {
    title,
    assignedTo,
    sprint,
    quarterTag,
    cellTag,
    effort,
    description,
    acceptanceCriteria
  };
}

function fillFieldByFieldForm(parsed) {
  fieldTitle.value = parsed.title || '';
  fieldAssigned.value = parsed.assignedTo || '';
  fieldSprint.value = parsed.sprint || '';
  fieldQuarterTag.value = parsed.quarterTag || '';
  fieldCellTag.value = parsed.cellTag || '';
  fieldEffort.value = parsed.effort || '';
  fieldDescription.value = parsed.description || '';
  fieldAcceptance.value = parsed.acceptanceCriteria || '';
}

function getCurrentFormData() {
  if (tabRawText.classList.contains('is-active')) {
    return parseTaskFromRawText(rawTaskText.value);
  }

  return {
    title: fieldTitle.value.trim(),
    assignedTo: fieldAssigned.value.trim(),
    sprint: fieldSprint.value.trim(),
    quarterTag: fieldQuarterTag.value.trim(),
    cellTag: fieldCellTag.value.trim(),
    effort: fieldEffort.value.trim(),
    description: fieldDescription.value.trim(),
    acceptanceCriteria: fieldAcceptance.value.trim()
  };
}

function toggleSubtaskEstimateVisibility() {
  const shouldShow = Boolean(chkCreateSubtask.checked);
  subtaskEstimateRawWrap.classList.toggle('is-hidden', !shouldShow);
  subtaskEstimateFieldWrap.classList.toggle('is-hidden', !shouldShow);
}

function syncSubtaskEstimate(sourceInput) {
  const value = sourceInput.value;
  if (sourceInput === subtaskEstimateRaw) {
    subtaskEstimateField.value = value;
  } else {
    subtaskEstimateRaw.value = value;
  }
}

function getSubtaskEstimateValue() {
  const rawValue = Number(subtaskEstimateRaw.value || subtaskEstimateField.value);
  if (!Number.isNaN(rawValue) && rawValue > 0) {
    return rawValue;
  }
  return 3;
}

function openTaskModal(context) {
  pendingCreateContext = context;
  taskModalTitle.textContent = context?.mode === 'child' ? 'Crear work item por debajo (Tarea)' : 'Crear work item del mismo tipo (Tarea)';
  rawTaskText.value = '';
  chkCreateSubtask.checked = false;
  subtaskEstimateRaw.value = '3';
  subtaskEstimateField.value = '3';
  toggleSubtaskEstimateVisibility();
  fillFieldByFieldForm({});
  tabRawText.classList.add('is-active');
  tabFieldByField.classList.remove('is-active');
  panelRawText.classList.remove('is-hidden');
  panelFieldByField.classList.add('is-hidden');
  taskModal.classList.remove('is-hidden');
}

function closeTaskModal() {
  taskModal.classList.add('is-hidden');
  pendingCreateContext = null;
}

function showResultModal(payload) {
  const lines = [`Tarea: ${payload.taskId || '-'}`];
  if (payload.subtaskId) {
    lines.push(`Subtarea: ${payload.subtaskId}`);
  }
  resultContent.textContent = lines.join('\n');
  resultModal.classList.remove('is-hidden');
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
    detailActionButtons.classList.add('is-hidden');
    btnCreateChild.classList.remove('is-hidden');
    btnCreateSameType.textContent = 'Crear mismo tipo';
    btnCreateSameType.className = 'btn-secondary detail-create-btn';
    btnCreateChild.textContent = 'Crear por debajo';
    btnCreateChild.className = 'btn-secondary detail-create-btn';
    selectedWorkItemTitle.textContent = 'Selecciona un work item del arbol';
    selectedWorkItemMeta.textContent = 'Sin seleccion';
    detailSprint.textContent = '-';
    detailAssigned.textContent = '-';
    detailCell.textContent = '-';
    return;
  }

  detailActionButtons.classList.remove('is-hidden');
  const currentDepth = Math.min(Number(node.depth) || 0, 4);
  const currentTypeName = LEVEL_NAMES[currentDepth] || node.workItemType || 'Work Item';
  const childDepth = Math.min(currentDepth + 1, 4);
  const childTypeName = LEVEL_NAMES[childDepth] || 'Work Item';

  btnCreateSameType.textContent = `Crear ${currentTypeName}`;
  btnCreateSameType.className = `btn-secondary detail-create-btn create-depth-${currentDepth}`;
  btnCreateSameType.dataset.targetDepth = String(currentDepth);

  if (Number(node.depth) >= 4) {
    btnCreateChild.classList.add('is-hidden');
    btnCreateChild.dataset.targetDepth = '';
  } else {
    btnCreateChild.classList.remove('is-hidden');
    btnCreateChild.textContent = `Crear ${childTypeName}`;
    btnCreateChild.className = `btn-secondary detail-create-btn create-depth-${childDepth}`;
    btnCreateChild.dataset.targetDepth = String(childDepth);
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

function findParentIdByNodeId(nodes, targetId, parentId = null) {
  for (const node of nodes) {
    if (node.id === targetId) {
      return parentId;
    }
    const childParent = findParentIdByNodeId(node.children || [], targetId, node.id);
    if (childParent != null) {
      return childParent;
    }
  }
  return null;
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
  projectSelector.innerHTML = '';

  if (!roots.length) {
    projectSelector.innerHTML = '<span class="project-empty">No hay proyectos disponibles.</span>';
    return;
  }

  roots.forEach((root) => {
    const item = document.createElement('div');
    item.className = 'project-item';

    const label = document.createElement('label');
    label.className = 'project-item-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(root.id);
    checkbox.checked = preselected.includes(root.id);

    const text = document.createElement('span');
    text.textContent = `${root.id} - ${root.title}`;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'project-remove-btn';
    removeButton.textContent = 'x';
    removeButton.setAttribute('aria-label', `Retirar proyecto ${root.id}`);
    removeButton.addEventListener('click', () => {
      removeProjectFromAvailable(root.id);
    });

    label.appendChild(checkbox);
    label.appendChild(text);
    item.appendChild(label);
    item.appendChild(removeButton);
    projectSelector.appendChild(item);
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
    if (selectedNodeId === node.id) {
      selectedNodeId = null;
      selectedNodeData = null;
      updateDetailPanel(null);
      applyActiveFiltersAndRender();
      return;
    }

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
  saveBacklogOption(backlogName);
  renderBacklogOptions(loadBacklogOptions(payload.backlogName || backlogName), backlogName);
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

btnCreateSameType.addEventListener('click', () => {
  if (!selectedNodeData) return;
  const targetDepth = Number(btnCreateSameType.dataset.targetDepth);
  if (targetDepth !== 3) {
    setStatus('Por ahora solo esta habilitada la creacion de Tarea.');
    return;
  }

  const parentId = findParentIdByNodeId(originalTree, selectedNodeData.id);
  if (!parentId) {
    setStatus('No se pudo determinar el padre para crear la tarea del mismo tipo.');
    return;
  }

  openTaskModal({
    mode: 'same',
    parentId,
    node: selectedNodeData
  });
});

btnCreateChild.addEventListener('click', () => {
  if (!selectedNodeData) return;
  const targetDepth = Number(btnCreateChild.dataset.targetDepth);
  if (targetDepth !== 3) {
    setStatus('Por ahora solo esta habilitada la creacion de Tarea.');
    return;
  }

  const nodeDepth = Number(selectedNodeData.depth) || 0;
  let parentId = selectedNodeData.id;

  if (nodeDepth > 2) {
    const featureParent = findParentIdByNodeId(originalTree, selectedNodeData.id);
    if (featureParent) {
      parentId = featureParent;
    }
  }

  openTaskModal({
    mode: 'child',
    parentId,
    node: selectedNodeData
  });
});

tabRawText.addEventListener('click', () => {
  tabRawText.classList.add('is-active');
  tabFieldByField.classList.remove('is-active');
  panelRawText.classList.remove('is-hidden');
  panelFieldByField.classList.add('is-hidden');

  const parsed = parseTaskFromRawText(rawTaskText.value);
  fillFieldByFieldForm(parsed);
});

tabFieldByField.addEventListener('click', () => {
  const parsed = parseTaskFromRawText(rawTaskText.value);
  fillFieldByFieldForm(parsed);

  tabFieldByField.classList.add('is-active');
  tabRawText.classList.remove('is-active');
  panelFieldByField.classList.remove('is-hidden');
  panelRawText.classList.add('is-hidden');
});

btnCloseTaskModal.addEventListener('click', () => {
  closeTaskModal();
});

btnCloseResultModal.addEventListener('click', () => {
  resultModal.classList.add('is-hidden');
});

btnSubmitCreateTask.addEventListener('click', async () => {
  if (!pendingCreateContext || !pendingCreateContext.node) {
    setStatus('Selecciona un work item antes de crear tarea.');
    return;
  }

  const formData = getCurrentFormData();
  if (!formData.title) {
    setStatus('El titulo es obligatorio para crear la tarea.');
    return;
  }

  const selectedSprintInfo = parseYearQuarterSprint(getNodeSprint(pendingCreateContext.node));
  const payload = {
    parentId: pendingCreateContext.parentId,
    title: formData.title,
    assignedTo: formData.assignedTo,
    sprint: formData.sprint,
    quarterTag: formData.quarterTag,
    cellTag: formData.cellTag,
    effort: formData.effort,
    description: formData.description,
    acceptanceCriteria: formData.acceptanceCriteria,
    createSubtask: chkCreateSubtask.checked,
    subtaskInitialEstimate: getSubtaskEstimateValue(),
    selectedContext: {
      iterationPath: pendingCreateContext.node.iterationPath,
      areaPath: pendingCreateContext.node.areaPath,
      year: selectedSprintInfo.year,
      quarter: selectedSprintInfo.quarter,
      sprint: selectedSprintInfo.sprint
    }
  };

  try {
    btnSubmitCreateTask.disabled = true;
    const response = await fetch('/api/workitems/create-task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'No se pudo crear la tarea.');
    }

    closeTaskModal();
    showResultModal(result);
    await loadHierarchy();
  } catch (error) {
    setStatus(error.message || 'Error al crear tarea.');
  } finally {
    btnSubmitCreateTask.disabled = false;
  }
});

chkCreateSubtask.addEventListener('change', () => {
  toggleSubtaskEstimateVisibility();
});

subtaskEstimateRaw.addEventListener('input', () => {
  syncSubtaskEstimate(subtaskEstimateRaw);
});

subtaskEstimateField.addEventListener('input', () => {
  syncSubtaskEstimate(subtaskEstimateField);
});

backlogSelector.addEventListener('change', () => {
  if (backlogSelector.value) {
    backlogInput.value = backlogSelector.value;
  }
});

btnChangeBacklog.addEventListener('click', async () => {
  const selectedBacklog = backlogSelector.value.trim();
  if (!selectedBacklog) {
    setStatus('Selecciona un backlog para cambiar.');
    return;
  }

  backlogInput.value = selectedBacklog;

  try {
    await loadHierarchy();
  } catch (error) {
    setError(error.message || 'Error inesperado al cambiar backlog.');
    setStatus('Error al cambiar backlog');
  }
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

btnAddProject.addEventListener('click', () => {
  const raw = newProjectIdInput.value.trim();
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    setStatus('Ingresa un ID de proyecto valido.');
    return;
  }

  removedProjectIds.delete(id);

  const alreadyInSystem = systemRoots.some((root) => root.id === id);
  const alreadyInCustom = customRoots.some((root) => root.id === id);

  if (!alreadyInSystem && !alreadyInCustom) {
    customRoots.push({
      id,
      title: `Proyecto ${id} (nuevo)`
    });
  }

  saveProjectPreferences();
  recomputeKnownRoots();

  const currentlySelected = new Set(selectedRootIds());
  currentlySelected.add(id);
  createRootSelector(knownRoots, Array.from(currentlySelected));

  newProjectIdInput.value = '';
  setStatus(`Proyecto ${id} adicionado.`);
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
  selectedNodeId = null;
  selectedNodeData = null;
  updateDetailPanel(null);
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
    loadProjectPreferences();

    systemRoots = Array.isArray(config.roots) ? config.roots : [];
    recomputeKnownRoots();

    const defaultRootIds = Array.isArray(config.defaultRootIds) ? config.defaultRootIds : [];
    const selectableDefaults = defaultRootIds.filter((id) => knownRoots.some((root) => root.id === id));

    backlogInput.value = config.defaultBacklogName || '';
    renderBacklogOptions(loadBacklogOptions(config.defaultBacklogName || ''), config.defaultBacklogName || '');
    createRootSelector(knownRoots, selectableDefaults);
    updateDetailPanel(null);

    await loadHierarchy();
  } catch (error) {
    setError(error.message || 'No se pudo inicializar la aplicacion.');
    setStatus('Error de inicializacion');
  }
})();
