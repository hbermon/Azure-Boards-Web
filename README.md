# Azure-Boards-Web

Aplicacion web local para Windows 11 que permite consultar y visualizar jerarquicamente work items de Azure Boards desde el navegador.

## Funcionalidad implementada

- Carga inicial del backlog configurado por variable de entorno `AZURE_BACKLOG_NAME`.
- Filtro por proyectos raiz (IDs de work items) usando `AZURE_ROOT_PROYECTOS`.
- Visualizacion jerarquica en arbol:
  Proyecto -> Epica -> Feature -> Tarea -> Subtarea.
- Interfaz dividida en 3 zonas:
  - Superior (ancho completo): nombre de backlog y selector de proyectos.
  - Inferior izquierda: panel reservado para detalle del work item (pendiente).
  - Inferior derecha: arbol jerarquico de work items.

## Requisitos

- Node.js 20 o superior

## Variables de entorno

La app usa el archivo `.env` en la raiz.

Variables principales:

- `AZURE_ORGANIZATION_URL`
- `AZURE_PROJECT_NAME`
- `AZURE_PERSONAL_ACCESS_TOKEN`
- `AZURE_BACKLOG_NAME`
- `AZURE_ROOT_PROYECTOS` (ejemplo: `1101182,1000656,1000263,1141112`)
- `AZURE_AREA_PATH_PREFIX` (opcional, para filtrar `System.AreaPath`)

Tambien se incluye `.env.example` como referencia.

## Ejecucion local

1. Instalar dependencias:

	```bash
	npm install
	```

2. Levantar la app:

	```bash
	npm start
	```

3. Abrir en navegador:

	```
	http://localhost:3000
	```

## Estructura

- `server.js`: API y conexion a Azure DevOps.
- `public/index.html`: estructura de interfaz.
- `public/styles.css`: estilos y layout responsive.
- `public/app.js`: logica de UI y render del arbol.
