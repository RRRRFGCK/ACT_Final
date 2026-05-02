const STORAGE_KEY = "final-review-question-bank-v2";

let questions = loadQuestions();
let editingId = null;
let selectedImage = null;
let dbMode = "local";
let supabaseClient = null;
let currentReviewQuestionId = null;

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
document.addEventListener("paste", handlePasteImage);
const dropZone = document.querySelector(".drop-zone");
dropZone?.addEventListener("dragover", handleDragOver);
dropZone?.addEventListener("dragleave", handleDragLeave);
dropZone?.addEventListener("drop", handleDropImage);
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
window.addEventListener("load", () => renderMath());

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
  if (name === "review") renderRandomQuestion();
}

function handleImageChange(event) {
  setSelectedImage(event.target.files[0], "图片");
}

function setSelectedImage(file, sourceLabel = "图片") {
  if (!file || !file.type?.startsWith("image/")) {
    setStatus("请上传图片文件");
    return;
  }
  selectedImage = file;
  els.previewImage.src = URL.createObjectURL(file);
  els.previewImage.hidden = false;
  setStatus(`${sourceLabel}已选择，可以开始 AI 识别`);
}

function handlePasteImage(event) {
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  setSelectedImage(item.getAsFile(), "剪贴板图片");
}

function handleDragOver(event) {
  event.preventDefault();
  document.querySelector(".drop-zone")?.classList.add("drag-over");
}

function handleDragLeave() {
  document.querySelector(".drop-zone")?.classList.remove("drag-over");
}

function handleDropImage(event) {
  event.preventDefault();
  document.querySelector(".drop-zone")?.classList.remove("drag-over");
  const file = [...(event.dataTransfer?.files || [])].find((entry) => entry.type.startsWith("image/"));
  setSelectedImage(file, "拖拽图片");
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
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      const shortText = raw.replace(/\s+/g, " ").slice(0, 120);
      throw new Error(`AI 接口没有返回 JSON。可能是 /api/extract-question 没部署成功。返回内容：${shortText}`);
    }
    if (!response.ok) throw new Error(data.error || "AI 识别失败");
    els.questionInput.value = data.question || "";
    els.optionsInput.value = formatOptions(data.options || []);
    els.correctAnswerInput.value = data.correctAnswer || "";
    els.answerInput.value = normalizeAnswerContent(data.answer, data.correctAnswer, data.options || []);
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

  const wasEditing = Boolean(editingId);
  els.saveQuestionButton.disabled = true;
  els.saveQuestionButton.textContent = wasEditing ? "正在更新..." : "正在保存...";
  setStatus(wasEditing ? "正在更新题目..." : "正在保存题目...");

  try {
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

    if (!wasEditing) {
      const shouldContinue = await confirmDuplicateQuestion(question);
      if (!shouldContinue) {
        setStatus("已取消保存：疑似重复题");
        return;
      }
    }

    if (dbMode === "cloud") {
      await saveCloudQuestion(question);
      await fetchCloudQuestions();
    } else {
      questions = editingId ? questions.map((item) => (item.id === editingId ? question : item)) : [question, ...questions];
      persistQuestions();
      renderAll();
    }

    resetForm();
    renderAll();
    showView("library");
    setStatus(wasEditing ? "已更新，题库已刷新" : "已保存，题库已刷新");
  } catch (error) {
    console.error(error);
    showFormMessage(error.message || "保存失败，请稍后再试。");
    setStatus("保存失败");
  } finally {
    els.saveQuestionButton.disabled = false;
    els.saveQuestionButton.textContent = wasEditing ? "更新题目" : "保存题目";
  }
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
  const rawQuery = els.searchInput.value.trim();
  const query = normalizeText(rawQuery);
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
    els.questionList.innerHTML = `<p class="empty-state">没有找到匹配关键词的题目。</p>`;
    return;
  }
  filtered.forEach((question) => els.questionList.append(renderQuestionCard(question, rawQuery)));
  renderMath(els.questionList);
}
function renderQuestionCard(question, highlight = "") {
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
  setMathHTML(text, question.text, highlight);
  const optionText = formatOptions(question.options || []);
  setMathHTML(answer, [
    optionText ? `选项：\n${optionText}` : "",
    question.correctAnswer ? `正确选项：${question.correctAnswer}` : "",
    question.answer ? `答案/备注：\n${question.answer}` : ""
  ].filter(Boolean).join("\n\n"), highlight);
  setMathHTML(explanation, question.explanation ? `解析：\n${question.explanation}` : "", highlight);
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
  setStatus("正在删除题目...");
  if (dbMode === "cloud") {
    const { error } = await supabaseClient.from("questions").delete().eq("id", id);
    if (error) {
      alert(`删除失败：${error.message}`);
      setStatus("删除失败");
      return;
    }
    await fetchCloudQuestions();
    setStatus("已删除，题库已刷新");
    return;
  }
  questions = questions.filter((item) => item.id !== id);
  persistQuestions();
  renderAll();
  setStatus("已删除，题库已刷新");
}

function renderRandomQuestion() {
  if (!questions.length) {
    currentReviewQuestionId = null;
    els.reviewPanel.innerHTML = `<p class="empty-state">题库里有题后，这里会显示随机题目。</p>`;
    return;
  }

  let pool = questions;
  if (questions.length > 1 && currentReviewQuestionId) {
    pool = questions.filter((question) => question.id !== currentReviewQuestionId);
  }

  const question = pool[Math.floor(Math.random() * pool.length)];
  currentReviewQuestionId = question.id;
  let selectedChoice = "";
  els.reviewPanel.innerHTML = "";

  if (question.imageData) {
    const image = document.createElement("img");
    image.className = "review-image";
    image.src = question.imageData;
    image.alt = "题目原图";
    els.reviewPanel.append(image);
  }

  const meta = document.createElement("div");
  meta.className = "chips";
  [question.course, question.topic, question.type, question.difficulty].forEach((label) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    meta.append(chip);
  });

  const text = document.createElement("p");
  text.className = question.imageData ? "question-index-text" : "review-question";
  setMathHTML(text, question.imageData ? `AI 识别文字：${question.text}` : question.text);

  const options = document.createElement("div");
  options.className = "choice-list";
  shuffleArray([...(question.options || [])]).forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "choice-button";
    const label = option.label || String.fromCharCode(65 + index);
    button.dataset.label = label;
    setMathHTML(button, `${label}. ${option.text || ""}`);
    button.addEventListener("click", () => {
      selectedChoice = label;
      options.querySelectorAll(".choice-button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
    options.append(button);
  });

  const result = document.createElement("div");
  result.className = "answer-result";
  result.hidden = true;

  const confirmButton = document.createElement("button");
  confirmButton.className = "primary-button";
  confirmButton.textContent = "确认选择";
  confirmButton.disabled = !(question.options || []).length;

  const nextButton = document.createElement("button");
  nextButton.className = "secondary-button";
  nextButton.textContent = "下一题";
  nextButton.hidden = true;
  nextButton.addEventListener("click", renderRandomQuestion);

  confirmButton.addEventListener("click", () => {
    if (!selectedChoice) {
      result.hidden = false;
      result.className = "answer-result";
      result.textContent = "先选择一个选项。";
      return;
    }

    const correct = String(question.correctAnswer || "").trim().toUpperCase();
    result.hidden = false;
    if (correct && selectedChoice === correct) {
      result.className = "answer-result correct";
      result.textContent = `答对了：${selectedChoice}`;
    } else if (correct) {
      result.className = "answer-result wrong";
      result.textContent = `你选了 ${selectedChoice}，正确答案是 ${correct}`;
    } else {
      result.className = "answer-result";
      result.textContent = `已选择 ${selectedChoice}，这题还没有标准答案。`;
    }

    confirmButton.disabled = true;
    nextButton.hidden = false;
  });

  const reveal = document.createElement("button");
  reveal.className = "secondary-button";
  reveal.textContent = "显示解析";

  const detail = document.createElement("div");
  detail.className = "answer-block";
  detail.hidden = true;
  setMathHTML(detail, [
    question.correctAnswer ? `正确选项：${question.correctAnswer}` : "",
    question.answer ? `答案/备注：\n${question.answer}` : "",
    question.explanation ? `解析：\n${question.explanation}` : "解析：暂无"
  ].filter(Boolean).join("\n\n"));

  reveal.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    reveal.textContent = detail.hidden ? "显示解析" : "隐藏解析";
  });

  const actionRow = document.createElement("div");
  actionRow.className = "review-actions";
  actionRow.append(confirmButton, reveal, nextButton);

  els.reviewPanel.append(meta, text);
  if (options.children.length) els.reviewPanel.append(options, result);
  els.reviewPanel.append(actionRow, detail);
  renderMath(els.reviewPanel);
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
function confirmDuplicateQuestion(candidate) {
  const matches = findSimilarQuestions(getQuestionComparableText(candidate), editingId).filter((match) => match.score >= 0.7).slice(0, 3);
  if (!matches.length) return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "duplicate-modal-backdrop";
    const best = matches[0];
    overlay.innerHTML = `
      <section class="duplicate-modal" role="dialog" aria-modal="true" aria-label="疑似重复题确认">
        <h2>可能是重复题</h2>
        <p>系统发现这道题和已有题目很像，相似度 ${Math.round(best.score * 100)}%。请确认是否继续保存。</p>
        <div class="duplicate-modal-match">
          <strong>${escapeHtml(best.question.course)} / ${escapeHtml(best.question.topic)}</strong>
          <p>${escapeHtml(best.question.text).slice(0, 500)}</p>
        </div>
        <div class="duplicate-modal-actions">
          <button class="secondary-button duplicate-cancel" type="button">这是重复题，不保存</button>
          <button class="primary-button duplicate-continue" type="button">不是重复题，继续保存</button>
        </div>
      </section>
    `;
    document.body.append(overlay);
    overlay.querySelector(".duplicate-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector(".duplicate-continue").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
  });
}
function normalizeAnswerContent(answer, correctAnswer, options) {
  const raw = String(answer || "").trim();
  const label = String(correctAnswer || "").trim().toUpperCase();
  const selected = (options || []).find((option) => String(option.label || "").trim().toUpperCase() === label);

  if (!raw && selected) return selected.text || "";
  if (/^[A-E]$/i.test(raw) && selected) return selected.text || "";
  if (label && new RegExp(`^(the\\s+)?correct\\s+answer\\s+is\\s+${label}\\.?$`, "i").test(raw) && selected) {
    return selected.text || "";
  }
  if (label && new RegExp(`^正确答案是?\\s*${label}$`, "i").test(raw) && selected) {
    return selected.text || "";
  }

  return raw
    .replace(/^the\s+correct\s+answer\s+is\s+/i, "")
    .replace(/^正确答案是?\s*/i, "")
    .trim();
}
function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}
function setMathHTML(element, value, highlight = "") {
  const prepared = wrapBareLatex(value || "");
  const escaped = escapeHtml(prepared).replace(/\n/g, "<br>");
  element.innerHTML = highlightEscapedHTML(escaped, highlight);
}

function highlightEscapedHTML(html, highlight) {
  const terms = String(highlight || "")
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .map(escapeRegExp);

  if (!terms.length) return html;
  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  return html
    .split(/(\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g)
    .map((part) => {
      if (/^(\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])$/.test(part)) return part;
      return part.replace(pattern, `<mark class="search-hit">$1</mark>`);
    })
    .join("");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function wrapBareLatex(value) {
  return String(value)
    .split("\n")
    .map((line) => {
      if (/\$|\\\(|\\\[/.test(line)) return line;
      const trimmed = line.trim();
      const looksLikeFormula = /\\(?:sqrt|frac|times|cdot|sum|int|log|ln|sin|cos|tan|alpha|beta|gamma|rho|sigma|mu|mathbf|begin|end)|\^\{|_\{|[=<>≤≥]\s*-?\d/.test(trimmed);
      return looksLikeFormula ? line.replace(trimmed, `$${trimmed}$`) : line;
    })
    .join("\n");
}

function renderMath(root = document.body, tries = 0) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([root]).catch((error) => console.warn("MathJax render failed", error));
    return;
  }
  if (tries < 20) {
    window.setTimeout(() => renderMath(root, tries + 1), 150);
  }
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
















