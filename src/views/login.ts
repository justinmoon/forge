import { escapeHtml } from './layout';

export function renderLogin(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - forge</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .login-container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      max-width: 400px;
      width: 100%;
    }
    h1 {
      font-size: 2em;
      margin-bottom: 10px;
      text-align: center;
    }
    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
    }
    .button {
      display: block;
      width: 100%;
      padding: 12px 20px;
      background: #8b5cf6;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1em;
      text-decoration: none;
      text-align: center;
      font-weight: 600;
    }
    .button:hover { background: #7c3aed; }
    .button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 5px;
      margin-bottom: 20px;
      border: 1px solid #fcc;
    }
    .info {
      background: #e3f2fd;
      color: #1565c0;
      padding: 12px;
      border-radius: 5px;
      margin-top: 20px;
      font-size: 0.9em;
      border: 1px solid #90caf9;
    }
    .info a {
      color: #1565c0;
      text-decoration: underline;
    }
    #status {
      text-align: center;
      margin-top: 15px;
      font-size: 0.9em;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>🔥 forge</h1>
    <p class="subtitle">CI/CD Platform</p>
    
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    
    <button id="loginBtn" class="button">
      Login with Nostr
    </button>
    
    <div id="status"></div>
    
    <div class="info" id="extensionInfo" style="display: none;">
      To use Nostr authentication, you need a NIP-07 compatible browser extension like:
      <ul style="margin: 10px 0 0 20px;">
        <li><a href="https://getalby.com/" target="_blank">Alby</a></li>
        <li><a href="https://github.com/fiatjaf/nos2x" target="_blank">nos2x</a></li>
        <li><a href="https://github.com/nostr-connect/nostr-connect" target="_blank">nostr-connect</a></li>
      </ul>
    </div>
  </div>

  <script>
    const loginBtn = document.getElementById('loginBtn');
    const status = document.getElementById('status');
    const extensionInfo = document.getElementById('extensionInfo');

    async function login() {
      try {
        // Check if window.nostr is available
        if (!window.nostr) {
          extensionInfo.style.display = 'block';
          status.textContent = 'No Nostr extension found';
          return;
        }

        loginBtn.disabled = true;
        status.textContent = 'Requesting public key...';

        // Get public key
        const pubkey = await window.nostr.getPublicKey();
        status.textContent = 'Fetching challenge...';

        // Get challenge from server
        const challengeRes = await fetch('/auth/challenge');
        if (!challengeRes.ok) {
          throw new Error('Failed to get challenge');
        }
        const { challenge } = await challengeRes.json();

        status.textContent = 'Please sign the authentication request...';

        // Create auth event (NIP-98 style)
        const event = {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: challenge
        };

        // Sign the event
        const signedEvent = await window.nostr.signEvent(event);

        status.textContent = 'Verifying signature...';

        // Send signed event to server
        const verifyRes = await fetch('/auth/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            event: signedEvent,
            challenge: challenge
          })
        });

        const result = await verifyRes.json();

        if (!verifyRes.ok) {
          throw new Error(result.error || 'Authentication failed');
        }

        status.textContent = 'Success! Redirecting...';
        
        // Redirect to home page
        setTimeout(() => {
          window.location.href = '/';
        }, 500);

      } catch (error) {
        console.error('Login error:', error);
        status.textContent = 'Error: ' + error.message;
        loginBtn.disabled = false;
      }
    }

    loginBtn.addEventListener('click', login);

    // Check for extension on load
    window.addEventListener('load', () => {
      if (!window.nostr) {
        extensionInfo.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}
