document.getElementById("fillForm").addEventListener("click", () => {
  const mappingText = document.getElementById("mappingText").value;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) return alert('No active tab found. Open the form page in a tab and try again.');
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: fillForm,
      args: [mappingText]
    }, (results) => {
      if (chrome.runtime.lastError) {
        alert('Error injecting script: ' + chrome.runtime.lastError.message);
      }
    });
  });
});

// This function runs in the page context
function fillForm(mappingText) {
  try {
    const lines = mappingText.split("\n").map(l => l.trim()).filter(l => l);

    function norm(s){ return (s||'').toString().trim().toLowerCase(); }

    lines.forEach(line => {
      // Normalize common patterns and typos
      const cleaned = line.replace(/\s+/g, ' ').replace(/slect\s+from\s+dropdown/i, 'select from dropdown');
      // Try to parse: Label* select from dropdown(Value) OR Label* (Value) OR Label* (file upload)
      const dropdownMatch = cleaned.match(/^(.*?)\*\s*select from dropdown\((.*?)\)$/i);
      const fileMatch = cleaned.match(/^(.*?)\*\s*\(?file upload\)?$/i);
      const genericMatch = cleaned.match(/^(.*?)\*\s*\(?(.+?)\)?$/);

      let label = null, value = null, mode = 'text';
      if (dropdownMatch) {
        label = dropdownMatch[1].trim();
        value = dropdownMatch[2].trim();
        mode = 'select';
      } else if (fileMatch) {
        label = fileMatch[1].trim();
        mode = 'file';
      } else if (genericMatch) {
        label = genericMatch[1].trim();
        value = genericMatch[2] ? genericMatch[2].trim() : '';
        mode = 'text';
      } else {
        // fallback: try "Label (Value)"
        const m = cleaned.match(/^(.*?)\s*\((.*?)\)$/);
        if (m) { label = m[1].trim(); value = m[2].trim(); mode='text'; }
        else return; // can't parse line
      }

      // Find element by many heuristics
      const allFields = Array.from(document.querySelectorAll('input, textarea, select'));
      let target = null;

      // 1) match by name/id/placeholder/aria-label
      for (const el of allFields) {
        const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')];
        for (const a of attrs) {
          if (!a) continue;
          if (norm(a) === norm(label) || norm(a).includes(norm(label)) || norm(label).includes(norm(a))) {
            target = el; break;
          }
        }
        if (target) break;
      }

      // 2) match by label text
      if (!target) {
        const labels = Array.from(document.querySelectorAll('label'));
        for (const lab of labels) {
          const txt = (lab.innerText || lab.textContent || '').trim();
          if (!txt) continue;
          if (norm(txt).includes(norm(label)) || norm(label).includes(norm(txt)) ) {
            const forId = lab.getAttribute('for');
            if (forId) { const el = document.getElementById(forId); if (el) { target = el; break; } }
            const inside = lab.querySelector('input,select,textarea');
            if (inside) { target = inside; break; }
          }
        }
      }

      // 3) fallback: check placeholders and nearby text nodes
      if (!target) {
        for (const el of allFields) {
          if ((el.previousElementSibling && (el.previousElementSibling.innerText||'').toLowerCase().includes(label.toLowerCase()))) { target = el; break; }
        }
      }

      if (!target) {
        console.warn('No element found for', label);
        return;
      }

      // Set value according to type
      if (mode === 'file') {
        // We cannot set files programmatically from this injected function without user interaction.
        // Notify via console and leave the input for manual file selection.
        console.warn('File field detected for', label, ' — please attach file manually to the file input.');
        // If the file input is visible, focus it to help the user:
        try { target.scrollIntoView({behavior:'smooth', block:'center'}); target.focus(); } catch(e) {}
        return;
      }

      if (target.tagName.toLowerCase() === 'select' || mode === 'select') {
        const v = value || '';
        const opts = Array.from(target.options || []);
        let matched = opts.find(o => norm(o.textContent) === norm(v) || norm(o.value) === norm(v));
        if (!matched) matched = opts.find(o => norm(o.textContent).includes(norm(v)));
        if (matched) { target.value = matched.value; target.dispatchEvent(new Event('change', { bubbles: true })); }
        else {
          // fallback: try to set value directly
          try { target.value = value; target.dispatchEvent(new Event('change', { bubbles: true })); }
          catch(e){ console.warn('Could not set select for', label); }
        }
        return;
      }

      // normal text inputs
      try {
        target.focus && target.focus();
        target.value = value || '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        console.warn('Failed to set value for', label, e);
      }
    });

    // briefly notify user
    const banner = document.createElement('div');
    banner.style.position = 'fixed';
    banner.style.right = '12px';
    banner.style.bottom = '12px';
    banner.style.background = 'rgba(76,175,80,0.95)';
    banner.style.color = 'white';
    banner.style.padding = '8px 12px';
    banner.style.borderRadius = '6px';
    banner.style.zIndex = 2147483647;
    banner.innerText = 'Form Filler: attempted to set fields (check console for details).';
    document.body.appendChild(banner);
    setTimeout(()=> banner.remove(), 3800);
  } catch (err) {
    console.error('Form Filler error:', err);
  }
}
