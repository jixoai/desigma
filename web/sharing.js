import { readInvitation } from './invitations.js';

export function mountSharing({ connections, transport, end }) {
  const $ = id => document.getElementById(id), panel = $('sharing-panel'), toggle = $('connect-devices');
  let busy = false, timer;
  const status = message => { $('sharing-status').textContent = message; };
  const options = () => {
    let ice_servers;
    try { ice_servers = JSON.parse($('sharing-ice').value.trim() || '[]'); } catch { throw new Error('STUN / TURN configuration must be a JSON array.'); }
    if (!Array.isArray(ice_servers) || ice_servers.length > 4) throw new Error('Use up to four STUN / TURN servers.');
    return { ice_servers, password: $('sharing-password').value };
  };
  const show = open => {
    panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); clearInterval(timer);
    if (open) {
      $('sharing-close').focus();
      timer = setInterval(() => {
        const state = transport.status();
        if (state.joined || state.peers > 0) status(state.hosting ? `${state.peers} guest${state.peers === 1 ? '' : 's'} connected. Keep this tab open.` : 'Connected. Changes sync with the host.');
      }, 1500);
    } else toggle.focus();
  };
  const output = (result, label) => {
    $('sharing-output-group').hidden = !result.link;
    if (result.link) { $('sharing-output-label').textContent = label; $('sharing-output').value = result.link; }
  };
  const action = async fn => {
    if (busy) return;
    busy = true; for (const id of ['sharing-create', 'sharing-accept', 'sharing-end']) $(id).disabled = true;
    try { await fn(); } catch (error) { status(error.message || String(error)); }
    finally { busy = false; for (const id of ['sharing-create', 'sharing-accept', 'sharing-end']) $(id).disabled = false; }
  };
  $('sharing-create').onclick = () => action(async () => {
    status('Preparing your invitation…');
    const result = await connections.create({ ...options(), server: $('sharing-server').value.trim(), role: $('sharing-role').value, approval: $('sharing-approval').checked });
    output(result, 'Invitation link');
    status(result.reply_required ? 'Send this invitation. Then paste the guest’s reply link below to finish connecting. The invitation expires after two minutes.' : 'Send this invitation. Guests can connect while this tab stays open.');
  });
  $('sharing-accept').onclick = () => action(async () => {
    const link = $('sharing-input').value.trim();
    if (readInvitation(link).kind !== 'answer' && !$('sharing-discard').checked) throw new Error('Check “Replace my current document when joining” before continuing. Download a copy first if you want to keep it.');
    status('Preparing the connection…');
    const result = await connections.accept({ ...options(), link, name: $('sharing-name').value.trim() || 'Guest', discard_changes: $('sharing-discard').checked });
    output(result, 'Reply link for the host');
    status(result.reply_required ? 'Send this reply link back to the host. Keep this tab open while they accept it.' : 'Connecting… If approval is enabled, the host must admit you from Share.');
  });
  $('sharing-end').onclick = () => action(async () => { connections.close(); await end(); output({}); status('Connection ended. You can keep editing locally.'); });
  $('sharing-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('sharing-output').value); status('Link copied.'); }
    catch { $('sharing-output').focus(); $('sharing-output').select(); status('Select and copy the link above.'); }
  };
  $('sharing-close').onclick = () => show(false); toggle.onclick = () => show(panel.hidden); toggle.disabled = false;
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); show(false); } });
  function incoming() {
    if (!location.hash.startsWith('#connect=')) return;
    try {
      const data = readInvitation(location.href); $('sharing-input').value = location.href;
      show(true); status(data.kind === 'answer' ? 'A guest sent a reply. Use the link in the host’s original tab to finish connecting.' : data.kind === 'invite' ? `Invitation via ${new URL(data.server).host}. Review your document, then use the connection link to join.` : 'You have an invitation. Join to create a reply link for the host.');
      history.replaceState(null, '', location.pathname + location.search);
    } catch (error) { show(true); status(error.message); }
  }
  window.addEventListener('hashchange', incoming); incoming();
  return { status };
}
