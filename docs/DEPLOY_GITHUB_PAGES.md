# Desplegar en GitHub Pages

## 1. Crear el repositorio

Crea un repositorio y copia el contenido del ZIP. El código puede ser público: no contiene notas ni credenciales privadas.

```bash
git init
git add .
git commit -m "feat: initial Notas Drive PWA"
git branch -M main
git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 2. Añadir la variable pública

En GitHub:

```text
Settings → Secrets and variables → Actions → Variables
```

Crea:

```text
GOOGLE_CLIENT_ID = 1234567890-abc.apps.googleusercontent.com
```

El workflow falla explícitamente si falta.

## 3. Activar Pages

En:

```text
Settings → Pages
```

Selecciona **GitHub Actions** como fuente de despliegue.

## 4. Autorizar el origen en Google

Para una URL de proyecto como:

```text
https://TU_USUARIO.github.io/TU_REPO/
```

el origen autorizado es:

```text
https://TU_USUARIO.github.io
```

No se registra la ruta `/TU_REPO/`.

## 5. Publicar

Un push a `main` ejecuta:

1. comprobaciones estáticas;
2. pruebas unitarias;
3. build con el Client ID;
4. creación del artefacto Pages;
5. despliegue.

También puedes ejecutar el workflow manualmente desde **Actions**.

## Dominio dedicado

Para mayor aislamiento, configura un subdominio exclusivo, por ejemplo:

```text
notas.tudominio.com
```

Después:

1. configura el custom domain en GitHub Pages;
2. añade el DNS indicado por GitHub;
3. espera a que HTTPS esté activo;
4. cambia el origen autorizado de Google a `https://notas.tudominio.com`;
5. elimina orígenes que ya no utilices.

## Actualizaciones

Cada despliegue usa el SHA del commit como `BUILD_VERSION`. El Service Worker crea una caché diferente y elimina las anteriores. Al detectar una actualización instalada, la PWA muestra un aviso para recargar.

## Revisión posterior

- Comprueba que `config.js` solo contiene el Client ID público.
- Comprueba que no se hayan añadido archivos `.env`.
- Abre DevTools → Application → Service Workers.
- Verifica que las solicitudes de Drive van directamente a `www.googleapis.com`.
- Verifica que GitHub no recibe el contenido de las notas.
