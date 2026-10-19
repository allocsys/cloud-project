// Lets plain Node run the server code: maps the '@/' import alias to the repo root.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
