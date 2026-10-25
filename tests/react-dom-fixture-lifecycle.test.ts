import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useEffect } from 'react';
import { Fixture } from './dropdown-fixture.ts';

test('replacing a mounted fixture child runs its effect cleanup before whole-fixture disposal', async () => {
  const fixture = new Fixture();
  const lifecycle: string[] = [];
  function Child() {
    useEffect(() => {
      lifecycle.push('mounted');
      return () => { lifecycle.push('cleaned'); };
    }, []);
    return createElement('p', null, 'Mounted child');
  }
  try {
    await fixture.mount(createElement(Child));
    assert.deepEqual(lifecycle, ['mounted'], 'The real effect must run before testing replacement cleanup.');
    await fixture.mount(createElement('p', null, 'Replacement child'));
    assert.match(fixture.root.textContent ?? '', /Replacement child/, 'The replacement must render before cleanup is observed.');
    assert.deepEqual(lifecycle, ['mounted', 'cleaned'], 'Removing the child must clean up its effect before disposing the whole fixture.');
  } finally { await fixture.dispose(); }
});
