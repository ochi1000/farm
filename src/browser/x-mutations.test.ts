import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { XPage } from './x-page.js';

test('mobile account menu is read and restored without animation-frame clicks', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<a data-testid="AppTabBar_Home_Link">Home</a><button data-testid="DashButton_ProfileIcon_Link" aria-expanded="false" onclick="const open=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',String(!open));document.querySelector('[role=dialog]').hidden=open">Account</button><div role="dialog" hidden><a href="/lab_account">Profile</a></div>`);
    const session = await new XPage(page).getSessionState();
    assert.equal(session.accountHandle, 'lab_account');
    assert.equal(await page.locator('[data-testid="DashButton_ProfileIcon_Link"]').getAttribute('aria-expanded'), 'false');
  } finally { await browser.close(); }
});

test('post and pinned comment are verified on the authored timeline', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let published = '';
  await page.exposeFunction('saveFixture', (text: string) => { published = text; });
  const nav = '<a data-testid="AppTabBar_Home_Link" href="/home">Home</a><a data-testid="AppTabBar_Profile_Link" href="/lab_account">Profile</a>';
  try {
    await page.route('https://x.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/save') {
        published = url.searchParams.get('text') || '';
        await route.fulfill({ status: 302, headers: { location: 'https://x.com/home' }, body: '' }); return;
      }
      let body = nav;
      if (url.pathname === '/lab_account/with_replies') {
        body += `<article data-testid="tweet"><div data-testid="User-Name">Lab @lab_account</div><div data-testid="tweetText">${published}</div><a href="https://x.com/lab_account/status/999"><time>now</time></a></article>`;
      } else {
        body += '<article data-testid="tweet"><div data-testid="tweetText">Garden photo</div><a href="https://x.com/other/status/123"><time>now</time></a><button data-testid="reply">Reply</button></article>';
        if (url.pathname !== '/home') body += `<div data-testid="tweetTextarea_0" contenteditable="true"> </div><button data-testid="tweetButton" onclick="window.saveFixture(document.querySelector('[contenteditable]').textContent).then(() => { document.querySelector('[contenteditable]').remove(); history.pushState({}, '', '/home'); })">Post</button>`;
      }
      await route.fulfill({ contentType: 'text/html', body });
    });
    const x = new XPage(page);
    const post = await x.createPost('Automation test fixture', true);
    assert.equal(post.state, 'post_verified');
    assert.equal(post.target, 'https://x.com/lab_account/status/999');
    await page.goto('https://x.com/target');
    const comment = await x.commentOnVisiblePost(8, 'Lovely garden', true, 'https://x.com/other/status/123');
    assert.equal(comment.state, 'comment_verified');
    assert.equal(published.trim(), 'Lovely garden');
  } finally { await browser.close(); }
});
