import { launchServices } from './services.mjs';

launchServices([['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server.ts'], ['node_modules/vite/bin/vite.js'], ['node_modules/tsx/dist/cli.mjs', 'factory/daemon.ts']]);
