const STORAGE_KEY = "final-review-question-bank-v2";

let questions = loadQuestions();
let editingId = null;
let selectedImage = null;
let dbMode = "local";
let supabaseClient = null;

const els = {
  views: document.querySelectorAll(".view"),
  tabs: document.querySelectorAll(".nav-tab"),
  imageInput: document.getElementById("questionImage"),
  previewImage: document.getElementById("previewImage"),
  aiExtractButton: document.getElementById("aiExtractButton"),
  ocrStatus: document.getElementById("ocrStatus"),
  courseInput: document.getElementById("courseInput"),
  topicInput: document.getElementById("topicInput"),
  typeInput: document.getElementById("typeInput"),
  difficultyInput: document.getElementById("difficultyInput"),
  questionInput: document.getElementById("questionInput"),
  optionsInput: document.getElementById("optionsInput"),
  correctAnswerInput: document.getElementById("correctAnswerInput"),
  answerInput: document.getElementById("answerInput"),
  explanationInput: document.getElementById("explanationInput"),
  tagsInput: document.getElementById("tagsInput"),
  duplicatePreview: document.getElementById("duplicatePreview"),
  saveQuestionButton: document.getElementById("saveQuestionButton"),
  generateExplanationButton: document.getElementById("generateExplanationButton"),
  clearFormButton: document.getElementById("clearFormButton"),
  questionList: document.getElementById("questionList"),
  searchInput: document.getElementById("searchInput"),
  courseFilter: document.getElementById("courseFilter"),
  statusFilter: document.getElementById("statusFilter"),
  exportButton: document.getElementById("exportButton"),
  reviewPanel: document.getElementById("reviewPanel"),
  randomQuestionButton: document.getElementById("randomQuestionButton"),
  duplicateList: document.getElementById("duplicateList"),
  scanDuplicatesButton: document.getElementById("scanDuplicatesButton"),
  statTotal: document.getElementById("statTotal"),
  statWithExplanations: document.getElementById("statWithExplanations"),
  statReviewed: document.getElementById("statReviewed"),
  template: document.getElementById("questionCardTemplate")
};

els.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
els.imageInput.addEventListener("change", handleImageChange);
els.aiExtractButton.addEventListener("click", runAiExtract);
els.saveQuestionButton.addEventListener("click", saveQuestionFromForm);
els.generateExplanationButton.addEventListener("click", generateExplanationDraft);
els.clearFormButton.addEventListener("click", resetForm);
els.searchInput.addEventListener("input", renderLibrary);
els.courseFilter.addEventListener("change", renderLibrary);
els.statusFilter.addEventListener("change", renderLibrary);
els.exportButton.addEventListener("click", exportQuestions);
els.randomQuestionButton.addEventListener("click", renderRandomQuestion);
els.scanDuplicatesButton.addEventListener("click", renderDuplicates);
els.questionInput.addEventListener("input", renderDuplicatePreview);
els.optionsInput.addEventListener("input", renderDuplicatePreview);

renderAll();
initCloudMode();

async function initCloudMode() {
  const config = window.APP_CONFIG || {};
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !window.supabase) return;
  supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  dbMode = "cloud";
  els.ocrStatus.textContent = "已连接云端题库";
  await fetchCloudQuestions();
  supabaseClient.channel("questions-changes").on("postgres_changes", { event: "*", schema: "public", table: "questions" }, fetchCloudQuestions).subscribe();
}

async function fetchCloudQuestions() {
  const { data, error } = await supabaseClient.from("questions").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    els.ocrStatus.textContent = "云端读取失败，请检查 Supabase 表和权限";
    return;
  }
  questions = (data || []).map(fromCloudQuestion);
  renderAll();
}

function showView(name) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  els.views.forEach((view) => view.classList.remove("active"));
  document.getElementById(`${name}View`).classList.add("active");
  if (name === "duplicates") renderDuplicates();
}

function handleImageChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedImage = file;
  els.previewImage.src = URL.createObjectURL(file);
  els.previewImage.hidden = false;
  els.ocrStatus.textContent = "图片已选择，可以开始识别";
}

async function runAiExtract() {
  if (!selectedImage) return setStatus("请先选择一张图片");
  if (location.protocol === "file:") return setStatus("AI 识别需要在 Vercel 网址上使用");
  els.aiExtractButton.disabled = true;
  setStatus("AI 正在识别题干、公式和选项...");
  try {
    const imageDataUrl = await fileToResizedDataUrl(selectedImage);
    const response = await fetch("/api/extract-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI 识别失败");
    els.questionInput.value = data.question || "";
    els.optionsInput.value = formatOptions(data.options || []);
    els.correctAnswerInput.value = data.correctAnswer || "";
    els.answerInput.value = data.answer || data.correctAnswer || "";
    els.explanationInput.value = data.explanation || data.notes || "";
    setStatus("AI 识别完成，建议快速检查一遍");
    renderDuplicatePreview();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "AI 识别失败");
  } finally {
    els.aiExtractButton.disabled = false;
  }
}

async function saveQuestionFromForm() {
  const text = els.questionInput.value.trim();
  if (!text) return showFormMessage("题目内容不能为空。");
  const now = new Date().toISOString();
  const existing = editingId ? questions.find((question) => question.id === editingId) : null;
  const question = {
    id: editingId || crypto.randomUUID(),
    course: els.courseInput.value.trim() || "未分类课程",
    topic: els.topicInput.value.trim() || "未分类章节",
    type: els.typeInput.value,
    difficulty: els.difficultyInput.value,
    text,
    options: parseOptions(els.optionsInput.value),
    correctAnswer: els.correctAnswerInput.value.trim().toUpperCase(),
    answer: els.answerInput.value.trim(),
    explanation: els.explanationInput.value.trim() || existing?.explanation || els.questionInput.dataset.explanationDraft || "",
    imageData: selectedImage ? await fileToResizedDataUrl(selectedImage) : existing?.imageData || "",
    tags: parseTags(els.tagsInput.value),
    reviewed: existing?.reviewed || false,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (dbMode === "cloud") await saveCloudQuestion(question);
  else {
    questions = editingId ? questions.map((item) => (item.id === editingId ? question : item)) : [question, ...questions];
    persistQuestions();
    renderAll();
  }
  resetForm();
  showView("library");
}

async function saveCloudQuestion(question) {
  const payload = toCloudQuestion(question);
  const request = editingId ? supabaseClient.from("questions").update(payload).eq("id", editingId) : supabaseClient.from("questions").insert(payload);
  const { error } = await request;
  if (error) {
    showFormMessage(`云端保存失败：${error.message}`);
    throw error;
  }
}

function generateExplanationDraft() {
  const text = els.questionInput.value.trim();
  if (!text) return showFormMessage("先填入题目内容，再生成解析草稿。");
  const draft = [
    "解析草稿", "", "题目：", text,
    els.optionsInput.value.trim() ? `\n选项：\n${els.optionsInput.value.trim()}` : "",
    els.correctAnswerInput.value.trim() ? `\n参考答案：${els.correctAnswerInput.value.trim()}` : "\n参考答案：暂未填写",
    "", "提示词：请基于上面这道复习题生成中文解析，包括考点、推导步骤、正确答案、易错点和一句记忆提示。"
  ].join("\n");
  navigator.clipboard?.writeText(draft).catch(() => {});
  els.questionInput.dataset.explanationDraft = draft;
  showFormMessage("已生成解析草稿，并尝试复制到剪贴板。");
}

function resetForm() {
  editingId = null;
  selectedImage = null;
  els.imageInput.value = "";
  els.previewImage.hidden = true;
  els.previewImage.removeAttribute("src");
  setStatus(dbMode === "cloud" ? "已连接云端题库" : "等待上传图片");
  els.courseInput.value = "";
  els.topicInput.value = "";
  els.typeInput.value = "选择题";
  els.difficultyInput.value = "普通";
  els.questionInput.value = "";
  els.optionsInput.value = "";
  els.correctAnswerInput.value = "";
  els.answerInput.value = "";
  els.tagsInput.value = "";
  els.questionInput.dataset.explanationDraft = "";
  els.duplicatePreview.hidden = true;
  els.saveQuestionButton.textContent = "保存题目";
}

function renderAll() {
  renderStats();
  renderCourseFilter();
  renderLibrary();
  renderDuplicates();
}

function renderStats() {
  els.statTotal.textContent = questions.length;
  els.statWithExplanations.textContent = questions.filter((question) => question.explanation).length;
  els.statReviewed.textContent = questions.filter((question) => question.reviewed).length;
}

function renderCourseFilter() {
  const current = els.courseFilter.value;
  const courses = [...new Set(questions.map((question) => question.course))].sort();
  els.courseFilter.innerHTML = `<option value="">全部课程</option>`;
  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course;
    option.textContent = course;
    els.courseFilter.append(option);
  });
  els.courseFilter.value = current;
}

function renderLibrary() {
  const query = normalizeText(els.searchInput.value);
  const course = els.courseFilter.value;
  const status = els.statusFilter.value;
  const filtered = questions.filter((question) => {
    const haystack = normalizeText(getQuestionComparableText(question));
    const matchesQuery = !query || haystack.includes(query);
    const matchesCourse = !course || question.course === course;
    const matchesStatus = !status || (status === "explained" && question.explanation) || (status === "todo" && !question.explanation) || (status === "reviewed" && question.reviewed);
    return matchesQuery && matchesCourse && matchesStatus;
  });
  els.questionList.innerHTML = "";
  if (!filtered.length) {
    els.questionList.innerHTML = `<p class="empty-state">还没有符合条件的题目。</p>`;
    return;
  }
  filtered.forEach((question) => els.questionList.append(renderQuestionCard(question)));
}

function renderQuestionCard(question) {
  const node = els.template.content.cloneNode(true);
  const card = node.querySelector(".question-card");
  if (question.imageData) {
    const image = document.createElement("img");
    image.className = "card-image";
    image.src = question.imageData;
    image.alt = "题目原图";
    card.prepend(image);
  }
  const chips = node.querySelector(".chips");
  const title = node.querySelector("h3");
  const text = node.querySelector(".question-text");
  const answer = node.querySelector(".answer-block");
  const explanation = node.querySelector(".explanation-block");
  [question.course, question.topic, question.type, question.difficulty, ...question.tags].forEach((label) => {
    if (!label) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    chips.append(chip);
  });
  title.textContent = question.reviewed ? "已复习" : "待复习";
  text.textContent = question.text;
  const optionText = formatOptions(question.options || []);
  answer.textContent = [
    optionText ? `选项：\n${optionText}` : "",
    question.correctAnswer ? `正确选项：${question.correctAnswer}` : "",
    question.answer ? `答案/备注：\n${question.answer}` : ""
  ].filter(Boolean).join("\n\n");
  explanation.textContent = question.explanation ? `解析：\n${question.explanation}` : "";
  node.querySelector(".edit-button").addEventListener("click", () => editQuestion(question.id));
  node.querySelector(".reviewed-button").addEventListener("click", () => toggleReviewed(question.id));
  node.querySelector(".delete-button").addEventListener("click", () => deleteQuestion(question.id));
  return card;
}

function editQuestion(id) {
  const question = questions.find((item) => item.id === id);
  if (!question) return;
  editingId = id;
  els.courseInput.value = question.course;
  els.topicInput.value = question.topic;
  els.typeInput.value = question.type;
  els.difficultyInput.value = question.difficulty;
  els.questionInput.value = question.text;
  els.optionsInput.value = formatOptions(question.options || []);
  els.correctAnswerInput.value = question.correctAnswer || "";
  els.answerInput.value = question.answer;
  els.explanationInput.value = question.explanation || "";
  if (question.imageData) {
    els.previewImage.src = question.imageData;
    els.previewImage.hidden = false;
  }
  els.tagsInput.value = question.tags.join(", ");
  els.saveQuestionButton.textContent = "更新题目";
  renderDuplicatePreview();
  showView("upload");
}

async function toggleReviewed(id) {
  const question = questions.find((item) => item.id === id);
  if (!question) return;
  if (dbMode === "cloud") {
    const { error } = await supabaseClient.from("questions").update({ reviewed: !question.reviewed, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) alert(`更新失败：${error.message}`);
    return;
  }
  questions = questions.map((item) => item.id === id ? { ...item, reviewed: !item.reviewed, updatedAt: new Date().toISOString() } : item);
  persistQuestions();
  renderAll();
}

async function deleteQuestion(id) {
  if (!confirm("确定删除这道题吗？")) return;
  if (dbMode === "cloud") {
    const { error } = await supabaseClient.from("questions").delete().eq("id", id);
    if (error) alert(`删除失败：${error.message}`);
    return;
  }
  questions = questions.filter((item) => item.id !== id);
  persistQuestions();
  renderAll();
}

function renderRandomQuestion() {
  if (!questions.length) {
    els.reviewPanel.innerHTML = `<p class="empty-state">题库里有题后，这里会显示随机题目。</p>`;
    return;
  }
  const question = questions[Math.floor(Math.random() * questions.length)];
  els.reviewPanel.innerHTML = "";
  const meta = document.createElement("div");
  meta.className = "chips";
  [question.course, question.topic, question.type, question.difficulty].forEach((label) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    meta.append(chip);
  });
  const text = document.createElement("p");
  text.className = "review-question";
  text.textContent = question.text;
  const options = document.createElement("div");
  options.className = "choice-list";
  (question.options || []).forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "choice-button";
    const label = option.label || String.fromCharCode(65 + index);
    button.textContent = `${label}. ${option.text || ""}`;
    button.addEventListener("click", () => {
      options.querySelectorAll(".choice-button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
    options.append(button);
  });
  const reveal = document.createElement("button");
  reveal.className = "primary-button";
  reveal.textContent = "显示答案和解析";
  const detail = document.createElement("div");
  detail.className = "answer-block";
  detail.hidden = true;
  detail.textContent = [question.correctAnswer ? `正确选项：${question.correctAnswer}` : "", question.answer ? `答案/备注：\n${question.answer}` : "", question.explanation ? `解析：\n${question.explanation}` : "解析：暂无"].filter(Boolean).join("\n\n");
  reveal.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    reveal.textContent = detail.hidden ? "显示答案和解析" : "隐藏答案和解析";
  });
  if (question.imageData) {
    const image = document.createElement("img");
    image.className = "card-image";
    image.src = question.imageData;
    image.alt = "题目原图";
    els.reviewPanel.append(image);
  }
  els.reviewPanel.append(meta, text);
  if (options.children.length) els.reviewPanel.append(options);
  els.reviewPanel.append(reveal, detail);
}

function renderDuplicatePreview() {
  const text = getFormComparableText();
  if (!text.trim()) {
    els.duplicatePreview.hidden = true;
    return;
  }
  const matches = findSimilarQuestions(text, editingId).slice(0, 3);
  if (!matches.length) {
    els.duplicatePreview.hidden = true;
    return;
  }
  const best = matches[0];
  showFormMessage(`可能重复：与「${best.question.course} / ${best.question.topic}」相似度 ${Math.round(best.score * 100)}%。`);
}

function renderDuplicates() {
  const pairs = [];
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const score = similarity(getQuestionComparableText(questions[i]), getQuestionComparableText(questions[j]));
      if (score >= 0.55) pairs.push({ first: questions[i], second: questions[j], score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  els.duplicateList.innerHTML = "";
  if (!pairs.length) {
    els.duplicateList.innerHTML = `<p class="empty-state">暂时没有发现明显重复题。</p>`;
    return;
  }
  pairs.forEach((pair) => {
    const item = document.createElement("article");
    item.className = "duplicate-item";
    item.innerHTML = `<div class="duplicate-score">相似度 ${Math.round(pair.score * 100)}%</div><div><strong>${escapeHtml(pair.first.course)} / ${escapeHtml(pair.first.topic)}</strong><p>${escapeHtml(pair.first.text)}</p></div><div><strong>${escapeHtml(pair.second.course)} / ${escapeHtml(pair.second.topic)}</strong><p>${escapeHtml(pair.second.text)}</p></div>`;
    els.duplicateList.append(item);
  });
}

function findSimilarQuestions(text, excludeId) {
  return questions.filter((question) => question.id !== excludeId).map((question) => ({ question, score: similarity(text, getQuestionComparableText(question)) })).filter((match) => match.score >= 0.55).sort((a, b) => b.score - a.score);
}

function getFormComparableText() { return `${els.questionInput.value}\n${els.optionsInput.value}`; }
function getQuestionComparableText(question) { return [question.course, question.topic, question.text, formatOptions(question.options || []), question.answer, question.explanation, question.tags.join(" ")].join("\n"); }
function generateTrigrams(text) { const normalized = normalizeText(text); if (normalized.length <= 3) return new Set([normalized]); const grams = new Set(); for (let index = 0; index <= normalized.length - 3; index += 1) grams.add(normalized.slice(index, index + 3)); return grams; }
function similarity(a, b) { const first = generateTrigrams(a); const second = generateTrigrams(b); const intersection = [...first].filter((gram) => second.has(gram)).length; const union = new Set([...first, ...second]).size; return union ? intersection / union : 0; }
function normalizeText(text) { return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim(); }
function parseOptions(value) { return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => { const match = line.match(/^([A-Ea-e])[\).、:：\s-]+(.+)$/); return { label: match ? match[1].toUpperCase() : String.fromCharCode(65 + index), text: match ? match[2].trim() : line }; }); }
function formatOptions(options) { return (options || []).map((option, index) => { if (typeof option === "string") return option; const label = option.label || String.fromCharCode(65 + index); return `${label}. ${option.text || ""}`.trim(); }).filter(Boolean).join("\n"); }
function parseTags(value) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean); }
function loadQuestions() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function persistQuestions() { localStorage.setItem(STORAGE_KEY, JSON.stringify(questions)); }
function exportQuestions() { const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `final-review-question-bank-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); }
function toCloudQuestion(question) { return { course: question.course, topic: question.topic, type: question.type, difficulty: question.difficulty, text: question.text, image_data: question.imageData || "", options: question.options || [], correct_answer: question.correctAnswer || "", answer: question.answer, explanation: question.explanation, tags: question.tags, reviewed: question.reviewed, updated_at: question.updatedAt }; }
function fromCloudQuestion(question) { return { id: question.id, course: question.course, topic: question.topic, type: question.type, difficulty: question.difficulty, text: question.text, imageData: question.image_data || "", options: question.options || [], correctAnswer: question.correct_answer || "", answer: question.answer || "", explanation: question.explanation || "", tags: question.tags || [], reviewed: Boolean(question.reviewed), createdAt: question.created_at, updatedAt: question.updated_at }; }
function showFormMessage(message) { els.duplicatePreview.hidden = false; els.duplicatePreview.textContent = message; }
function setStatus(message) { els.ocrStatus.textContent = message; }
function fileToResizedDataUrl(file) { return new Promise((resolve, reject) => { const image = new Image(); const reader = new FileReader(); reader.onload = () => { image.onload = () => { const maxSide = 1800; const scale = Math.min(1, maxSide / Math.max(image.width, image.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL("image/jpeg", 0.88)); }; image.onerror = reject; image.src = reader.result; }; reader.onerror = reject; reader.readAsDataURL(file); }); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }





