// Puts a link in a message body. Like images, the body stays plain text: what
// goes in is [label](https://…), which the renderers turn into an anchor and
// the plain-text alternative flattens back to "label (https://…)".
//
// Whatever is selected in the textarea becomes the label, so the usual
// gesture — select the words, click the button, paste the address — works.
import React, { useState } from 'react';
import { Icon, Modal, Field, useToast } from '../ui.jsx';

export default function InsertLinkButton({ textareaRef, onInsert, disabled }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  function start() {
    const el = textareaRef?.current;
    const selected = el ? String(el.value).slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : '';
    setLabel(selected.trim());
    setUrl('');
    setOpen(true);
  }

  function add() {
    let href = url.trim();
    if (!href) return;
    // A pasted "example.org/page" is what someone means by a link, so fill in
    // the scheme rather than refusing it. Only http(s) renders as a link.
    if (!/^[a-zA-Z][\w+.-]*:/.test(href)) href = `https://${href}`;
    if (!/^https?:\/\//i.test(href)) {
      toast('Links must be http:// or https://', 'bad');
      return;
    }
    const text = label.trim();
    onInsert(text ? `[${text}](${href})` : href);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={start}>
        <Icon name="link" size={14} /> Insert link
      </button>
      {open ? (
        <Modal title="Insert a link" onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!url.trim()} onClick={add}>Insert</button>
            </>
          }>
          <Field label="Text to show" hint="Leave blank to show the address itself.">
            <input value={label} maxLength={300} autoFocus placeholder="our endorsements"
              onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Address" required>
            <input value={url} maxLength={600} placeholder="https://example.org/endorsements"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
