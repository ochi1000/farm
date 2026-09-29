/* No input values, cookies, page HTML, account text or URLs leave this script. */
(() => {
  const port = browser.runtime.connectNative('probe');
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const count = selector => [...document.querySelectorAll(selector)].filter(visible).length;
  function snapshot(command, before, requestId = '') {
    // Inspect only visible alert/dialog text for fixed categories, never export that text.
    const messages = [...document.querySelectorAll('[role="alert"], [role="dialog"]')]
      .filter(visible).map(el => el.innerText || '').join(' ').slice(0, 20000).toLowerCase();
    const posts = [...document.querySelectorAll('[data-testid="tweetText"]')].filter(visible);
    const path = location.pathname;
    return {
      command,
      requestId,
      documentHidden: document.hidden,
      viewportHeight: innerHeight,
      route: /^\/i\/flow\/login\/?$/.test(path) ? 'login' : path === '/home' ? 'home' : 'other',
      userAgent: navigator.userAgent,
      language: navigator.language,
      webdriver: navigator.webdriver === true,
      secureContext: isSecureContext,
      ready: document.readyState === 'complete',
      visiblePosts: posts.length,
      extractedCharacters: posts.slice(0, 5).reduce((n, el) => n + (el.innerText || '').length, 0),
      passwordFieldPresent: count('input[type="password"]') > 0,
      alertCount: count('[role="alert"]'),
      unsupportedBrowser: /unsupported browser|browser.*not supported/.test(messages),
      loginFailed: /could not log you in|unable to log|couldn.t log|could not sign/.test(messages),
      genericError: /something went wrong|try again later/.test(messages),
      challenge: /verify.*human|captcha|unusual activity/.test(messages),
      scrollBefore: Math.round(before ?? window.scrollY),
      scrollAfter: Math.round(window.scrollY)
    };
  }
  port.onMessage.addListener(message => {
    if (!['capture', 'scroll', 'read'].includes(message.command)) return;
    if (message.command === 'scroll') {
      const before = window.scrollY;
      // Reply in this message handler: hidden-page timers may not run before
      // the native command deadline. Instant scrolling also avoids animation.
      window.scrollBy({top: Math.round(innerHeight * 0.7), left: 0, behavior: 'instant'});
      // Report the observed offset, not an assumed movement or new-content load.
      port.postMessage(snapshot('scroll', before, message.requestId));
    } else {
      // Read measures actual DOM text extraction; report contains only counts.
      port.postMessage(snapshot(message.command, undefined, message.requestId));
    }
  });
  port.postMessage(snapshot('connected'));
})();
