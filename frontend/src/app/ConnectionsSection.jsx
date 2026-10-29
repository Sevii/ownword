import { useState } from 'react';
import { PROVIDERS, checkKey, connect, remove, setActive, setModel, endpointLabel } from '../ai/connections.js';
import { CUSTOM, validateBaseUrl } from '../ai/providers.js';
import { runAiRequest } from '../ai/client.js';

const TRY_TEXT = 'Their going to review the the report tomorow.';

/**
 * AI connections in Settings: add a key (checked by listing its models),
 * choose a model, pick which connection AI actions use, try it, or remove it.
 * @param {{ value: import('../ai/connections.js').Connections,
 *   onChange: (next: import('../ai/connections.js').Connections) => void,
 *   onConnected: () => void }} props
 */
export function ConnectionsSection({ value, onChange, onConnected, disabledProviders = [] }) {
  return (
    <section className="connections" aria-labelledby="connections-title">
      <h3 id="connections-title">AI connections</h3>
      <p className="muted">
        Use your own API key for AI writing help. Your key is saved on this device and sent directly to the provider.
        API usage is billed by your provider. On a shared device, tick “Don’t remember this key” or remove the key here.
        A custom endpoint runs models on your own machine or server, such as Ollama or LM Studio.
      </p>
      <ul className="connections__list">
        {PROVIDERS.map((p) => (
          <ConnectionRow key={p.id} provider={p} value={value} onChange={onChange} onConnected={onConnected} off={disabledProviders.includes(p.id)} />
        ))}
      </ul>
    </section>
  );
}

function ConnectionRow({ provider, value, onChange, onConnected, off }) {
  const conn = value.connections[provider.id];
  const active = value.active === provider.id;
  const custom = provider.id === CUSTOM;
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trial, setTrial] = useState(/** @type {{ state: 'running'|'done'|'failed', text: string } | null} */ (null));

  const canAdd = custom ? Boolean(url.trim()) : Boolean(key.trim());

  async function add() {
    if (!canAdd || busy) return;
    setError('');
    let baseUrl;
    if (custom) {
      try {
        baseUrl = validateBaseUrl(url);
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    setBusy(true);
    const result = await checkKey(provider.id, key, { baseUrl });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange(connect(value, provider.id, key, result, Date.now(), { baseUrl, remember }));
    setKey('');
    setUrl('');
    onConnected();
  }

  async function tryIt() {
    setTrial({ state: 'running', text: '' });
    const { terminal, preview } = await runAiRequest(
      {
        contractVersion: 1,
        clientRequestId: `try-${crypto.randomUUID()}`,
        provider: provider.id,
        model: conn.model,
        action: 'explain',
        sourceRevision: 0,
        blocks: [{ id: 'try', type: 'paragraph', text: TRY_TEXT }],
        editableBlockIds: ['try'],
        instruction: 'In one short sentence, what needs fixing?',
      },
      { key: conn.key, baseUrl: conn.baseUrl, onEvent: (_e, p) => setTrial({ state: 'running', text: p }) },
    );
    setTrial(
      terminal.type === 'completed'
        ? { state: 'done', text: terminal.text ?? preview }
        : { state: 'failed', text: terminal.message ?? 'The request did not finish.' },
    );
  }

  const inputId = `key-${provider.id}`;
  return (
    <li className={`conn${active ? ' conn--active' : ''}`}>
      <div className="conn__head">
        <span className="conn__name">{provider.name}</span>
        <span className="muted conn__product">{provider.product}</span>
        {off ? (
          <span className="pill pill--error">Turned off for now</span>
        ) : (
          conn && (
            <>
              {conn.remember === false && <span className="pill pill--muted" title="This key is kept only until the tab closes">Session only</span>}
              <span className={`pill ${active ? 'pill--ok' : ''}`}>{active ? 'In use' : 'Connected'}</span>
            </>
          )
        )}
      </div>
      {conn && custom && <p className="muted conn__endpoint">Endpoint: {endpointLabel(conn.baseUrl)}</p>}
      {off && <p className="panel-note">This provider is temporarily unavailable here. Your key is kept; try another provider meanwhile.</p>}
      {conn ? (
        <>
          <label className="field conn__model">
            <span>Model</span>
            <select value={conn.model} onChange={(e) => onChange(setModel(value, provider.id, e.target.value))}>
              {conn.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label} (${m.id})`}</option>
              ))}
            </select>
          </label>
          <div className="conn__actions">
            {!active && (
              <button type="button" className="btn btn--sm" onClick={() => onChange(setActive(value, provider.id))}>Use for AI</button>
            )}
            <button type="button" className="btn btn--sm btn--secondary" disabled={trial?.state === 'running'} onClick={tryIt}>
              Try it
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => (setTrial(null), onChange(remove(value, provider.id)))}>
              Remove key
            </button>
          </div>
          {trial && (
            <p className={`conn__trial conn__trial--${trial.state}`} role="status">
              {trial.state === 'running' && !trial.text ? 'Asking…' : trial.text}
            </p>
          )}
        </>
      ) : (
        <div className="conn__add">
          {custom && (
            <>
              <label className="visually-hidden" htmlFor={`${inputId}-url`}>Custom endpoint URL</label>
              <input
                id={`${inputId}-url`}
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={provider.urlHint}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </>
          )}
          <label className="visually-hidden" htmlFor={inputId}>{provider.name} API key</label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.keyHint}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              // The dialog is a form: Enter would close it instead of connecting.
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onKeyPress={(e) => e.key === 'Enter' && e.preventDefault()}
          />
          <button type="button" className="btn btn--sm" disabled={!canAdd || busy} onClick={add}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
          {provider.keysUrl && <a className="conn__get" href={provider.keysUrl} target="_blank" rel="noopener noreferrer">Get a key</a>}
          <label className="conn__remember">
            <input type="checkbox" checked={!remember} onChange={(e) => setRemember(!e.target.checked)} />
            Don’t remember this key on this device
          </label>
          {error && <p className="conn__error" role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}
