import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
// Explicit allowlist: never publish the repository, secrets, tests or backend.
for (const file of ['index.html', 'app.js', 'auth.js', 'validation.js', 'sw.js', 'icon.svg', 'manifest.webmanifest', '_headers']) {
  await copyFile(file, `dist/${file}`);
}
