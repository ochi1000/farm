import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { XPage } from './x-page.js';

test('X page reads feed state and verifies a like transition', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <a data-testid="AppTabBar_Home_Link" href="/home">Home</a>
      <a data-testid="AppTabBar_Profile_Link" href="/lab_account">Profile</a>
      <article data-testid="tweet">
        <div data-testid="User-Name">Lab User @lab_user</div>
        <div data-testid="tweetText">Fixture post</div>
        <a href="https://x.com/lab_user/status/123"><time datetime="2026-09-14T00:00:00Z">now</time></a>
        <button data-testid="like">Like</button>
        <button data-testid="reply">Reply</button>
      </article>
      <script>
        document.querySelector('[data-testid=like]').addEventListener('click', event => {
          event.currentTarget.dataset.testid = 'unlike';
          event.currentTarget.textContent = 'Unlike';
        });
      </script>
    `);
    const x = new XPage(page);
    assert.deepEqual(await x.getSessionState(), { loggedIn: true, accountHandle: 'lab_account' });
    const posts = await x.readVisibleFeed(5);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, 'Fixture post');
    assert.equal(posts[0]?.liked, false);
    assert.equal((await x.likeVisiblePost(0, false)).state, 'would_like');
    assert.equal((await x.likeVisiblePost(0, true)).state, 'liked');
    assert.equal((await x.likeVisiblePost(0, false)).state, 'already_liked');
    assert.equal((await x.commentOnVisiblePost(0, 'Reviewed reply', false)).state, 'would_comment');
  } finally {
    await browser.close();
  }
});

test('X page reports visible dialogs without dismissing them', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<a data-testid="AppTabBar_Home_Link">Home</a><div role="dialog">Turn on notifications Not now</div>');
    const state = await new XPage(page).getSessionState();
    assert.equal(state.loggedIn, true);
    assert.deepEqual(state.popups, ['Turn on notifications Not now']);
  } finally {
    await browser.close();
  }
});

test('X page labels a transient reload interruption', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<a data-testid="AppTabBar_Home_Link">Home</a><main>Something went wrong. Try reloading.</main>');
    const state = await new XPage(page).getSessionState();
    assert.equal(state.interruption, 'temporary reload error');
  } finally {
    await browser.close();
  }
});
