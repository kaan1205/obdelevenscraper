const state = { vehicles: null };

// Mirrors src/lib/slugify.js so option values line up with the keys
// discover-vehicles.js wrote into vehicles.json.
function slugify(label) {
  return String(label)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[|/]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const makeSelect = document.getElementById('make-select');
const modelSelect = document.getElementById('model-select');
const yearSelect = document.getElementById('year-select');
const submitButton = document.getElementById('submit-button');
const form = document.getElementById('vehicle-form');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results');
const resultsList = document.getElementById('results-list');

function setStatus(message, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle('status--error', isError);
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

function fillSelect(select, options, placeholder) {
  select.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  select.appendChild(placeholderOption);

  options.forEach(({ label }) => {
    const opt = document.createElement('option');
    opt.value = slugify(label);
    opt.textContent = label;
    select.appendChild(opt);
  });

  select.disabled = options.length === 0;
}

function resetSelect(select, placeholder) {
  select.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = placeholder;
  opt.disabled = true;
  opt.selected = true;
  select.appendChild(opt);
  select.disabled = true;
}

async function loadVehicles() {
  setStatus('Araç listesi yükleniyor...');
  try {
    const res = await fetch('/api/vehicles');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Araç listesi yüklenemedi');

    state.vehicles = data;
    fillSelect(makeSelect, data.makes, 'Marka seçin');
    clearStatus();
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
  }
}

makeSelect.addEventListener('change', () => {
  const makeSlug = makeSelect.value;
  const models = (state.vehicles.models && state.vehicles.models[makeSlug]) || [];
  fillSelect(modelSelect, models, models.length ? 'Model seçin' : 'Model bulunamadı');
  resetSelect(yearSelect, 'Önce model seçin');
  submitButton.disabled = true;
});

modelSelect.addEventListener('change', () => {
  const makeSlug = makeSelect.value;
  const modelSlug = modelSelect.value;
  const years =
    (state.vehicles.years[makeSlug] && state.vehicles.years[makeSlug][modelSlug]) || [];
  fillSelect(yearSelect, years, years.length ? 'Yıl seçin' : 'Yıl bulunamadı');
  submitButton.disabled = true;
});

yearSelect.addEventListener('change', () => {
  submitButton.disabled = !yearSelect.value;
});

function renderResults(items) {
  resultsList.innerHTML = '';

  items.forEach(({ original, translated }) => {
    const li = document.createElement('li');
    li.className = 'result-card';

    const translatedEl = document.createElement('p');
    translatedEl.className = 'result-title';
    translatedEl.textContent = translated;
    li.appendChild(translatedEl);

    if (translated !== original) {
      const originalEl = document.createElement('p');
      originalEl.className = 'result-original';
      originalEl.textContent = original;
      li.appendChild(originalEl);
    }

    resultsList.appendChild(li);
  });

  resultsSection.hidden = items.length === 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const make = makeSelect.value;
  const model = modelSelect.value;
  const year = yearSelect.value;

  submitButton.disabled = true;
  resultsSection.hidden = true;
  setStatus('Özelleştirmeler getiriliyor, ilk seferde biraz sürebilir...');

  try {
    const url = `/api/customizations?make=${encodeURIComponent(make)}&model=${encodeURIComponent(
      model
    )}&year=${encodeURIComponent(year)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');

    renderResults(data.items);
    setStatus(
      data.cached
        ? `Önbellekten yüklendi (${data.items.length} özelleştirme).`
        : `${data.items.length} özelleştirme bulundu (${data.totalPages} sayfa tarandı).`
    );
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
  } finally {
    submitButton.disabled = false;
  }
});

loadVehicles();
