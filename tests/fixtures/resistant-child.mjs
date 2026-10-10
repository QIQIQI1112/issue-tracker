import { writeFileSync } from 'node:fs';

process.on('SIGTERM', () => {
  if (process.env.OWNED_TERM_ACK) writeFileSync(process.env.OWNED_TERM_ACK, 'received');
  console.log('owned descendant survived SIGTERM');
});
console.log('owned stubborn descendant ready');
process.send({ ready: true }, () => process.disconnect());
setInterval(() => {}, 1000);
