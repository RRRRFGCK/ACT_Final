const STORAGE_KEY = "final-review-question-bank-v2";
const REVIEW_PROGRESS_KEY = "final-review-progress-v1";

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
  topicFilter: document.getElementById("topicFilter"),
  statusFilter: document.getElementById("statusFilter"),
  exportButton: document.getElementById("exportButton"),
  pdfExportButton: document.getElementById("pdfExportButton"),
  reviewPanel: document.getElementById("reviewPanel"),
  randomQuestionButton: document.getElementById("randomQuestionButton"),
  resetReviewProgressButton: document.getElementById("resetReviewProgressButton"),
  reviewCourseFilter: document.getElementById("reviewCourseFilter"),
  reviewTopicFilter: document.getElementById("reviewTopicFilter"),
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
els.courseFilter.addEventListener("change", () => {
  renderTopicFilter();
  renderLibrary();
});
els.topicFilter?.addEventListener("change", renderLibrary);
els.statusFilter.addEventListener("change", renderLibrary);
els.exportButton.addEventListener("click", exportQuestions);
els.pdfExportButton?.addEventListener("click", exportQuestionsPDF);
els.randomQuestionButton.addEventListener("click", renderRandomQuestion);
els.resetReviewProgressButton?.addEventListener("click", resetCurrentReviewProgress);
els.reviewCourseFilter?.addEventListener("change", () => {
  currentReviewQuestionId = null;
  renderReviewTopicFilter();
  renderRandomQuestion();
});
els.reviewTopicFilter?.addEventListener("change", () => {
  currentReviewQuestionId = null;
  renderRandomQuestion();
});
els.scanDuplicatesButton.addEventListener("click", renderDuplicates);
els.questionInput.addEventListener("input", renderDuplicatePreview);
// Duplicate detection intentionally follows the stem only; options/answers can vary by source.


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
  dropZone?.classList.add("has-image");
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
    els.questionInput.value = cleanAIText(data.question || "");
    els.optionsInput.value = formatOptions(cleanOptions(data.options || []));
    els.correctAnswerInput.value = data.correctAnswer || "";
    els.answerInput.value = normalizeAnswerContent(data.answer, data.correctAnswer, data.options || []);
    els.courseInput.value = "Imperial CSP ACT";
    els.topicInput.value = data.chapter || inferTopicFromRefs(data.sourceRefs || data.matchedMaterials || []) || "待确认章节";
    els.tagsInput.value = mergeTags(els.tagsInput.value, [data.knowledgePoint, ...(data.sourceRefs || [])]);
    els.explanationInput.value = cleanAIText(buildExplanationWithContext(data));
    const modelLabel = data.modelUsed ? `：${data.modelUsed}` : "";
    const chapterLabel = data.chapter ? `，${data.chapter}` : "，建议快速检查一遍";
    setStatus(`AI 识别完成${modelLabel}${chapterLabel}`);
    renderDuplicatePreview();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "AI 识别失败");
  } finally {
    els.aiExtractButton.disabled = false;
  }
}

async function saveQuestionFromForm() {
  const text = cleanAIText(els.questionInput.value.trim());
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
      options: cleanOptions(parseOptions(els.optionsInput.value)),
      correctAnswer: els.correctAnswerInput.value.trim().toUpperCase(),
      answer: els.answerInput.value.trim(),
      explanation: cleanAIText(els.explanationInput.value.trim() || existing?.explanation || els.questionInput.dataset.explanationDraft || ""),
      imageData: selectedImage ? await fileToResizedDataUrl(selectedImage) : existing?.imageData || "",
      tags: parseTags(els.tagsInput.value),
      reviewed: existing?.reviewed || false,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    if (!wasEditing) {
      const shouldContinue = await confirmDuplicateQuestion(question);
      if (!shouldContinue) {
        resetForm({ keepStatus: true });
        setStatus("已取消保存：疑似重复题，表单已清空");
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
    setStatus(wasEditing ? "已更新，题库已刷新，表单已清空" : "已保存，题库已刷新，表单已清空");
  } catch (error) {
    console.error(error);
    showFormMessage(error.message || "保存失败，请稍后再试。");
    setStatus("保存失败");
  } finally {
    els.saveQuestionButton.disabled = false;
    els.saveQuestionButton.textContent = editingId ? "更新题目" : "保存题目";
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
  const text = cleanAIText(els.questionInput.value.trim());
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

function resetForm(options = {}) {
  editingId = null;
  selectedImage = null;
  els.imageInput.value = "";
  els.previewImage.hidden = true;
  els.previewImage.removeAttribute("src");
  dropZone?.classList.remove("has-image", "drag-over");
  if (!options.keepStatus) setStatus(dbMode === "cloud" ? "已连接云端题库" : "等待上传图片");
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
  renderTopicFilter();
  renderReviewCourseFilter();
  renderReviewTopicFilter();
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
  const courses = [...new Set(questions.map((question) => question.course).filter(Boolean))].sort();
  els.courseFilter.innerHTML = `<option value="">全部课程</option>`;
  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course;
    option.textContent = course;
    els.courseFilter.append(option);
  });
  els.courseFilter.value = courses.includes(current) ? current : "";
}

function renderTopicFilter() {
  if (!els.topicFilter) return;
  const current = els.topicFilter.value;
  const course = els.courseFilter.value;
  const topics = [...new Set(questions
    .filter((question) => !course || question.course === course)
    .map((question) => question.topic)
    .filter(Boolean))].sort();
  els.topicFilter.innerHTML = `<option value="">全部章节</option>`;
  topics.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    els.topicFilter.append(option);
  });
  els.topicFilter.value = topics.includes(current) ? current : "";
}

function renderReviewCourseFilter() {
  if (!els.reviewCourseFilter) return;
  const current = els.reviewCourseFilter.value;
  const courses = [...new Set(questions.map((question) => question.course).filter(Boolean))].sort();
  els.reviewCourseFilter.innerHTML = `<option value="">全部课程</option>`;
  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course;
    option.textContent = course;
    els.reviewCourseFilter.append(option);
  });
  els.reviewCourseFilter.value = courses.includes(current) ? current : "";
}

function renderReviewTopicFilter() {
  if (!els.reviewTopicFilter) return;
  const current = els.reviewTopicFilter.value;
  const course = els.reviewCourseFilter?.value || "";
  const topics = [...new Set(questions
    .filter((question) => !course || question.course === course)
    .map((question) => question.topic)
    .filter(Boolean))].sort();
  els.reviewTopicFilter.innerHTML = `<option value="">全部章节</option>`;
  topics.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    els.reviewTopicFilter.append(option);
  });
  els.reviewTopicFilter.value = topics.includes(current) ? current : "";
}

function getReviewScope() {
  return {
    course: els.reviewCourseFilter?.value || "",
    topic: els.reviewTopicFilter?.value || ""
  };
}

function getReviewScopeKey(scope = getReviewScope()) {
  return `${scope.course || "*"}::${scope.topic || "*"}`;
}

function getReviewQuestionPool(scope = getReviewScope()) {
  return questions.filter((question) => {
    const matchesCourse = !scope.course || question.course === scope.course;
    const matchesTopic = !scope.topic || question.topic === scope.topic;
    return matchesCourse && matchesTopic;
  });
}

function getReviewQuestionIds(available) {
  return available.map((question) => question.id).filter(Boolean);
}

function loadReviewProgressStore() {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_PROGRESS_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveReviewProgressStore(store) {
  localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(store));
}

function getReviewProgress(scope, available) {
  const key = getReviewScopeKey(scope);
  const store = loadReviewProgressStore();
  const saved = store[key] || {};
  const availableIds = getReviewQuestionIds(available);
  const availableIdSet = new Set(availableIds);
  const savedQuestionIds = Array.isArray(saved.questionIds) ? saved.questionIds : availableIds;
  const questionIds = [
    ...savedQuestionIds.filter((id) => availableIdSet.has(id)),
    ...availableIds.filter((id) => !savedQuestionIds.includes(id))
  ];
  const completedFromIndex = Number.isFinite(Number(saved.index)) ? availableIds.slice(0, Number(saved.index)) : [];
  const savedCompletedIds = Array.isArray(saved.completedIds) ? saved.completedIds : completedFromIndex;
  const completedIds = savedCompletedIds.filter((id) => availableIdSet.has(id));
  const completedIdSet = new Set(completedIds);
  const wrongIds = Array.isArray(saved.wrongIds) ? saved.wrongIds.filter((id) => availableIdSet.has(id)) : [];
  const redoCompletedIds = Array.isArray(saved.redoCompletedIds) ? saved.redoCompletedIds.filter((id) => availableIdSet.has(id)) : [];
  const redoCompletedIdSet = new Set(redoCompletedIds);
  const currentId = questionIds.find((id) => !completedIdSet.has(id)) || wrongIds.find((id) => !redoCompletedIdSet.has(id)) || null;
  const isRedo = Boolean(currentId && completedIdSet.has(currentId));
  const reviewOrder = [...questionIds, ...wrongIds];
  const historyIds = [...completedIds, ...redoCompletedIds].filter((id) => availableIdSet.has(id));
  const previousId = historyIds.at(-1) || null;
  return {
    key,
    questionIds,
    completedIds,
    wrongIds,
    redoCompletedIds,
    attempts: saved.attempts || {},
    previousId,
    reviewOrder,
    historyIds,
    completedCount: completedIds.length + redoCompletedIds.length,
    currentId,
    isRedo,
    total: availableIds.length + wrongIds.length
  };
}

function saveReviewProgress(key, progress, result = {}, mergeExisting = true) {
  const store = loadReviewProgressStore();
  const existing = store[key] || {};
  const existingQuestionIds = mergeExisting && Array.isArray(existing.questionIds) ? existing.questionIds : [];
  const existingCompletedIds = mergeExisting && Array.isArray(existing.completedIds) ? existing.completedIds : [];
  const existingWrongIds = mergeExisting && Array.isArray(existing.wrongIds) ? existing.wrongIds : [];
  const existingRedoCompletedIds = mergeExisting && Array.isArray(existing.redoCompletedIds) ? existing.redoCompletedIds : [];
  const existingAttempts = mergeExisting && existing.attempts && typeof existing.attempts === "object" ? existing.attempts : {};
  const completedQuestionId = result.completedQuestionId || null;
  const questionIds = [...new Set([...(progress.questionIds || []), ...existingQuestionIds])];
  const completedIds = completedQuestionId
    ? [...new Set([...(progress.completedIds || []), ...existingCompletedIds, completedQuestionId])]
    : [...new Set([...(progress.completedIds || []), ...existingCompletedIds])];
  const wrongIds = result.wrongQuestionId
    ? [...new Set([...(progress.wrongIds || []), ...existingWrongIds, result.wrongQuestionId])]
    : [...new Set([...(progress.wrongIds || []), ...existingWrongIds])];
  const redoCompletedIds = result.redoQuestionId
    ? [...new Set([...(progress.redoCompletedIds || []), ...existingRedoCompletedIds, result.redoQuestionId])]
    : [...new Set([...(progress.redoCompletedIds || []), ...existingRedoCompletedIds])];
  const attempts = { ...(progress.attempts || {}), ...existingAttempts };
  if (result.attemptQuestionId) {
    attempts[result.attemptQuestionId] = {
      selectedChoice: result.selectedChoice || "",
      correctLabel: result.correctLabel || "",
      isCorrect: Boolean(result.isCorrect),
      isRedo: Boolean(result.isRedo),
      answeredAt: new Date().toISOString()
    };
  }
  store[key] = {
    questionIds,
    completedIds,
    wrongIds,
    redoCompletedIds,
    attempts,
    updatedAt: new Date().toISOString()
  };
  saveReviewProgressStore(store);
}

function resetCurrentReviewProgress() {
  const scope = getReviewScope();
  const available = getReviewQuestionPool(scope);
  const key = getReviewScopeKey(scope);
  saveReviewProgress(key, { questionIds: getReviewQuestionIds(available), completedIds: [], wrongIds: [], redoCompletedIds: [], attempts: {} }, {}, false);
  currentReviewQuestionId = null;
  renderRandomQuestion();
}
function getFilteredLibraryQuestions() {
  const rawQuery = els.searchInput.value.trim();
  const query = normalizeText(rawQuery);
  const course = els.courseFilter.value;
  const topic = els.topicFilter?.value || "";
  const status = els.statusFilter.value;
  return questions.filter((question) => {
    const haystack = normalizeText(getQuestionComparableText(question));
    const matchesQuery = !query || haystack.includes(query);
    const matchesCourse = !course || question.course === course;
    const matchesTopic = !topic || question.topic === topic;
    const matchesStatus = !status || (status === "explained" && question.explanation) || (status === "todo" && !question.explanation) || (status === "reviewed" && question.reviewed);
    return matchesQuery && matchesCourse && matchesTopic && matchesStatus;
  });
}

function renderLibrary() {
  const rawQuery = els.searchInput.value.trim();
  const filtered = getFilteredLibraryQuestions();
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

async function updateQuestionReviewFields(id, fields) {
  const updates = {
    options: cleanOptions(fields.options || []),
    correctAnswer: String(fields.correctAnswer || "").trim().toUpperCase(),
    answer: cleanAIText(fields.answer || ""),
    explanation: cleanAIText(fields.explanation || "")
  };
  const now = new Date().toISOString();
  if (dbMode === "cloud") {
    const { error } = await supabaseClient.from("questions").update({
      options: updates.options,
      correct_answer: updates.correctAnswer,
      answer: updates.answer,
      explanation: updates.explanation,
      updated_at: now
    }).eq("id", id);
    if (error) throw error;
    questions = questions.map((item) => item.id === id ? { ...item, ...updates, updatedAt: now } : item);
    return updates;
  }
  questions = questions.map((item) => item.id === id ? { ...item, ...updates, updatedAt: now } : item);
  persistQuestions();
  renderAll();
  return updates;
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
  const scope = getReviewScope();
  const available = getReviewQuestionPool(scope);
  if (!questions.length) {
    currentReviewQuestionId = null;
    els.reviewPanel.innerHTML = `<p class="empty-state">题库里有题后，这里会显示练习题。</p>`;
    return;
  }
  if (!available.length) {
    currentReviewQuestionId = null;
    els.reviewPanel.innerHTML = `<p class="empty-state">当前课程/章节下面还没有题目，换一个章节试试。</p>`;
    return;
  }

  const progress = getReviewProgress(scope, available);
  if (!progress.currentId) {
    currentReviewQuestionId = null;
    els.reviewPanel.innerHTML = `
      <div class="review-complete">
        <h3>这一套刷完了</h3>
        <p>进度 ${progress.total}/${progress.total}。可以重置后再刷一遍，或者换一个章节。</p>
        ${progress.historyIds.length ? `<button class="secondary-button" type="button" id="completeHistoryButton">\u67e5\u770b\u5df2\u505a\u9898\u76ee</button>` : ""}

        <button class="primary-button" type="button" id="completeResetButton">重置这套进度</button>
      </div>
    `;
    document.getElementById("completeHistoryButton")?.addEventListener("click", () => renderReviewHistory());
    document.getElementById("completeResetButton")?.addEventListener("click", resetCurrentReviewProgress);
    return;
  }

  const question = available.find((item) => item.id === progress.currentId);
  if (!question) {
    saveReviewProgress(progress.key, {
      questionIds: getReviewQuestionIds(available),
      completedIds: progress.completedIds,
      wrongIds: progress.wrongIds,
      redoCompletedIds: progress.redoCompletedIds,
      attempts: progress.attempts
    });
    renderRandomQuestion();
    return;
  }
  currentReviewQuestionId = question.id;
  let selectedChoice = "";
  els.reviewPanel.innerHTML = "";

  const progressLine = document.createElement("div");
  progressLine.className = "review-progress-line";
  progressLine.textContent = `\u8fdb\u5ea6 ${progress.completedCount + 1}/${progress.total}${progress.isRedo ? " \u00b7 \u9519\u9898\u91cd\u505a" : ""}`;
  els.reviewPanel.append(progressLine);

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
    if (!label) return;
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
  (question.options || []).forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "choice-button";
    const label = (option.label || String.fromCharCode(65 + index)).toUpperCase();
    button.dataset.label = label;
    setMathHTML(button, `${label}. ${option.text || ""}`);
    button.addEventListener("click", () => {
      selectedChoice = label;
      options.querySelectorAll(".choice-button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
    options.append(button);
  });

  const correctLabel = String(question.correctAnswer || "").trim().toUpperCase();

  const result = document.createElement("div");
  result.className = "answer-result";
  result.hidden = true;

  const confirmButton = document.createElement("button");
  confirmButton.className = "primary-button";
  confirmButton.textContent = "确认选择";
  confirmButton.disabled = !(question.options || []).length;

  const nextButton = document.createElement("button");
  nextButton.className = "secondary-button";
  nextButton.textContent = progress.completedCount + 1 >= progress.total ? "\u5b8c\u6210\u8fd9\u5957" : "\u4e0b\u4e00\u9898";
  nextButton.hidden = true;
  nextButton.addEventListener("click", renderRandomQuestion);

  const previousButton = document.createElement("button");
  previousButton.className = "secondary-button";
  previousButton.textContent = "\u4e0a\u4e00\u9898";
  previousButton.hidden = !progress.previousId;
  previousButton.addEventListener("click", () => renderPreviousReviewQuestion(progress.previousId));

  const historyButton = document.createElement("button");
  historyButton.className = "secondary-button";
  historyButton.textContent = "\u5df2\u505a\u9898\u76ee";
  historyButton.hidden = !progress.historyIds.length;
  historyButton.addEventListener("click", () => renderReviewHistory());

  confirmButton.addEventListener("click", () => {
    if (!selectedChoice) {
      result.hidden = false;
      result.className = "answer-result";
      result.textContent = "先选择一个选项。";
      return;
    }

    result.hidden = false;
    const isCorrect = Boolean(correctLabel && selectedChoice === correctLabel);
    if (isCorrect) {
      result.className = "answer-result correct";
      result.textContent = `答对了：${selectedChoice}`;
    } else if (correctLabel) {
      result.className = "answer-result wrong";
      result.textContent = `你选了 ${selectedChoice}，正确答案是 ${correctLabel}`;
    } else {
      result.className = "answer-result";
      result.textContent = `已选择 ${selectedChoice}，这题还没有标准答案。`;
    }

    saveReviewProgress(progress.key, progress, {
      completedQuestionId: progress.isRedo ? null : question.id,
      wrongQuestionId: !progress.isRedo && correctLabel && !isCorrect ? question.id : null,
      redoQuestionId: progress.isRedo ? question.id : null,
      attemptQuestionId: question.id,
      selectedChoice,
      correctLabel,
      isCorrect,
      isRedo: progress.isRedo
    });
    if (!progress.isRedo && correctLabel && !isCorrect) {
      nextButton.textContent = "\u4e0b\u4e00\u9898";
    }
    confirmButton.disabled = true;
    options.querySelectorAll(".choice-button").forEach((item) => { item.disabled = true; });
    nextButton.hidden = false;
  });

  const reveal = document.createElement("button");
  reveal.className = "secondary-button";
  reveal.textContent = "显示解析";

  const detail = document.createElement("div");
  detail.className = "answer-block";
  detail.hidden = true;
  setMathHTML(detail, buildReviewDetailText(question, correctLabel));

  const editExplanationButton = createReviewExplanationEditor(question, detail, () => renderRandomQuestion());

  reveal.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    reveal.textContent = detail.hidden ? "显示解析" : "隐藏解析";
  });

  const actionRow = document.createElement("div");
  actionRow.className = "review-actions";
  actionRow.append(previousButton, historyButton, confirmButton, reveal, editExplanationButton, nextButton);

  els.reviewPanel.append(meta, text);
  if (options.children.length) els.reviewPanel.append(options, result);
  els.reviewPanel.append(actionRow, detail);
  renderMath(els.reviewPanel);
}

function renderReviewHistory() {
  const scope = getReviewScope();
  const available = getReviewQuestionPool(scope);
  const progress = getReviewProgress(scope, available);
  const historyIds = [...new Set(progress.historyIds)].filter((id) => available.some((question) => question.id === id));

  els.reviewPanel.innerHTML = "";

  const progressLine = document.createElement("div");
  progressLine.className = "review-progress-line";
  progressLine.textContent = "\u5df2\u505a\u9898\u76ee";
  els.reviewPanel.append(progressLine);

  if (!historyIds.length) {
    els.reviewPanel.innerHTML += `<p class="empty-state">\u8fd8\u6ca1\u6709\u53ef\u56de\u770b\u7684\u9898\u76ee\u3002</p>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "review-history-list";
  historyIds.forEach((id, index) => {
    const question = available.find((item) => item.id === id);
    const attempt = progress.attempts?.[id] || {};
    const button = document.createElement("button");
    button.className = "review-history-item";
    button.type = "button";

    const title = document.createElement("strong");
    title.textContent = `${index + 1}. ${[question.course, question.topic].filter(Boolean).join(" / ") || "\u5df2\u505a\u9898\u76ee"}`;

    const meta = document.createElement("span");
    const selected = attempt.selectedChoice ? `\u4f60\u9009 ${attempt.selectedChoice}` : "\u65e0\u9009\u62e9\u8bb0\u5f55";
    const correctness = attempt.selectedChoice ? (attempt.isCorrect ? "\u7b54\u5bf9" : "\u7b54\u9519") : "";
    meta.textContent = [selected, correctness].filter(Boolean).join(" · ");

    const preview = document.createElement("small");
    preview.textContent = cleanAIText(question.text || "").slice(0, 140);

    button.append(title, meta, preview);
    button.addEventListener("click", () => renderPreviousReviewQuestion(id));
    list.append(button);
  });

  const backButton = document.createElement("button");
  backButton.className = "primary-button";
  backButton.textContent = "\u8fd4\u56de\u7ee7\u7eed\u5237\u9898";
  backButton.addEventListener("click", renderRandomQuestion);

  const actionRow = document.createElement("div");
  actionRow.className = "review-actions";
  actionRow.append(backButton);

  els.reviewPanel.append(list, actionRow);
}

function createReviewExplanationEditor(question, detail, onSaved = () => {}) {
  const editButton = document.createElement("button");
  editButton.className = "secondary-button";
  editButton.type = "button";
  editButton.textContent = "\u7f16\u8f91\u9898\u76ee\u5185\u5bb9";

  editButton.addEventListener("click", () => {
    const editor = document.createElement("div");
    editor.className = "review-explanation-editor";

    const optionsLabel = document.createElement("label");
    optionsLabel.textContent = "\u9009\u9879";
    const optionsInput = document.createElement("textarea");
    optionsInput.rows = 6;
    optionsInput.value = formatOptions(question.options || []);
    optionsLabel.append(optionsInput);

    const answerGrid = document.createElement("div");
    answerGrid.className = "review-editor-grid";

    const correctLabel = document.createElement("label");
    correctLabel.textContent = "\u6b63\u786e\u9009\u9879";
    const correctInput = document.createElement("input");
    correctInput.type = "text";
    correctInput.value = question.correctAnswer || "";
    correctLabel.append(correctInput);

    const answerLabel = document.createElement("label");
    answerLabel.textContent = "\u7b54\u6848/\u5907\u6ce8";
    const answerInput = document.createElement("textarea");
    answerInput.rows = 3;
    answerInput.value = question.answer || "";
    answerLabel.append(answerInput);
    answerGrid.append(correctLabel, answerLabel);

    const explanationLabel = document.createElement("label");
    explanationLabel.textContent = "\u89e3\u6790";
    const explanationInput = document.createElement("textarea");
    explanationInput.rows = 7;
    explanationInput.value = question.explanation || "";
    explanationLabel.append(explanationInput);

    const status = document.createElement("span");
    status.className = "review-editor-status";

    const saveButton = document.createElement("button");
    saveButton.className = "primary-button";
    saveButton.type = "button";
    saveButton.textContent = "\u4fdd\u5b58\u4fee\u6539";

    const cancelButton = document.createElement("button");
    cancelButton.className = "secondary-button";
    cancelButton.type = "button";
    cancelButton.textContent = "\u53d6\u6d88";

    const editorActions = document.createElement("div");
    editorActions.className = "review-actions";
    editorActions.append(saveButton, cancelButton, status);

    editor.append(optionsLabel, answerGrid, explanationLabel, editorActions);
    detail.replaceWith(editor);
    editButton.hidden = true;
    optionsInput.focus();

    cancelButton.addEventListener("click", () => {
      editor.replaceWith(detail);
      editButton.hidden = false;
    });

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      status.textContent = "\u6b63\u5728\u4fdd\u5b58...";
      try {
        const updates = await updateQuestionReviewFields(question.id, {
          options: parseOptions(optionsInput.value),
          correctAnswer: correctInput.value,
          answer: answerInput.value,
          explanation: explanationInput.value
        });
        Object.assign(question, updates);
        setMathHTML(detail, buildReviewDetailText(question));
        editor.replaceWith(detail);
        editButton.hidden = false;
        status.textContent = "";
        onSaved(updates);
      } catch (error) {
        console.error(error);
        status.textContent = `\u4fdd\u5b58\u5931\u8d25\uff1a${error.message || ""}`;
      } finally {
        saveButton.disabled = false;
      }
    });
  });

  return editButton;
}

function buildReviewDetailText(question, correctLabel = String(question.correctAnswer || "").trim().toUpperCase()) {
  return [
    correctLabel ? `\u6b63\u786e\u9009\u9879\uff1a${correctLabel}` : "",
    question.answer ? `\u7b54\u6848/\u5907\u6ce8\uff1a\n${question.answer}` : "",
    question.explanation ? `\u89e3\u6790\uff1a\n${question.explanation}` : "\u89e3\u6790\uff1a\u6682\u65e0"
  ].filter(Boolean).join("\n\n");
}
function renderPreviousReviewQuestion(questionId) {
  const scope = getReviewScope();
  const available = getReviewQuestionPool(scope);
  const progress = getReviewProgress(scope, available);
  const question = available.find((item) => item.id === questionId);
  if (!question) {
    renderRandomQuestion();
    return;
  }

  const attempt = progress.attempts?.[question.id] || {};
  const selectedChoice = attempt.selectedChoice || "";
  const correctLabel = attempt.correctLabel || String(question.correctAnswer || "").trim().toUpperCase();
  els.reviewPanel.innerHTML = "";

  const progressLine = document.createElement("div");
  progressLine.className = "review-progress-line";
  progressLine.textContent = "\u4e0a\u4e00\u9898\u56de\u770b";
  els.reviewPanel.append(progressLine);

  if (question.imageData) {
    const image = document.createElement("img");
    image.className = "review-image";
    image.src = question.imageData;
    image.alt = "é¢˜ç›®åŽŸå›¾";
    els.reviewPanel.append(image);
  }

  const meta = document.createElement("div");
  meta.className = "chips";
  [question.course, question.topic, question.type, question.difficulty].forEach((label) => {
    if (!label) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    meta.append(chip);
  });

  const text = document.createElement("p");
  text.className = question.imageData ? "question-index-text" : "review-question";
  setMathHTML(text, question.imageData ? `AI è¯†åˆ«æ–‡å­—ï¼š${question.text}` : question.text);

  const options = document.createElement("div");
  options.className = "choice-list";
  (question.options || []).forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "choice-button";
    const label = (option.label || String.fromCharCode(65 + index)).toUpperCase();
    button.disabled = true;
    if (label === selectedChoice) button.classList.add("selected");
    setMathHTML(button, `${label}. ${option.text || ""}`);
    options.append(button);
  });

  const result = document.createElement("div");
  result.className = `answer-result${attempt.isCorrect ? " correct" : correctLabel ? " wrong" : ""}`;
  result.textContent = selectedChoice
    ? `\u4f60\u521a\u624d\u9009\u4e86 ${selectedChoice}${correctLabel ? `\uff0c\u6b63\u786e\u7b54\u6848\u662f ${correctLabel}` : ""}`
    : "\u8fd9\u9898\u6682\u65f6\u6ca1\u6709\u9009\u62e9\u8bb0\u5f55\u3002";

  const detail = document.createElement("div");
  detail.className = "answer-block";
  setMathHTML(detail, buildReviewDetailText(question, correctLabel));
  const editExplanationButton = createReviewExplanationEditor(question, detail, () => renderPreviousReviewQuestion(question.id));

  const backButton = document.createElement("button");
  backButton.className = "primary-button";
  backButton.textContent = "\u8fd4\u56de\u7ee7\u7eed\u5237\u9898";
  backButton.addEventListener("click", renderRandomQuestion);

  const actionRow = document.createElement("div");
  actionRow.className = "review-actions";
  actionRow.append(backButton, editExplanationButton);

  els.reviewPanel.append(meta, text);
  if (options.children.length) els.reviewPanel.append(options, result);
  els.reviewPanel.append(actionRow, detail);
  renderMath(els.reviewPanel);
}
function renderDuplicatePreview() {
  const text = getFormQuestionStemText();
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
      const score = similarity(getQuestionStemText(questions[i]), getQuestionStemText(questions[j]));
      if (score >= 0.5) pairs.push({ first: questions[i], second: questions[j], score });
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
    item.innerHTML = `
      <div class="duplicate-score">相似度 ${Math.round(pair.score * 100)}%</div>
      <div class="duplicate-compare">
        ${renderDuplicateSide(pair.first, "左边题目")}
        ${renderDuplicateSide(pair.second, "右边题目")}
      </div>
    `;
    item.querySelectorAll("[data-action='edit']").forEach((button) => {
      button.addEventListener("click", () => editQuestion(button.dataset.id));
    });
    item.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => deleteQuestion(button.dataset.id));
    });
    els.duplicateList.append(item);
  });
}

function renderDuplicateSide(question, label) {
  return `
    <section class="duplicate-side">
      <div class="duplicate-side-heading">
        <span>${label}</span>
        <strong>${escapeHtml(question.course)} / ${escapeHtml(question.topic)}</strong>
      </div>
      ${question.imageData ? `<img class="duplicate-side-image" src="${question.imageData}" alt="题目原图">` : ""}
      <p>${escapeHtml(question.text)}</p>
      <div class="duplicate-side-actions">
        <button class="secondary-button" type="button" data-action="edit" data-id="${question.id}">编辑</button>
        <button class="danger-button" type="button" data-action="delete" data-id="${question.id}">删除</button>
      </div>
    </section>
  `;
}

function findSimilarQuestions(text, excludeId, threshold = 0.5) {
  return questions
    .filter((question) => question.id !== excludeId)
    .map((question) => ({
      question,
      score: similarity(text, getQuestionStemText(question)),
    }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

function getFormQuestionStemText() { return els.questionInput.value; }
function getQuestionStemText(question) { return question.text || ""; }
function getQuestionComparableText(question) { return [question.course, question.topic, question.text, formatOptions(question.options || []), question.answer, question.explanation, question.tags.join(" ")].join("\n"); }
function generateTrigrams(text) { const normalized = normalizeText(text); if (normalized.length <= 3) return new Set([normalized]); const grams = new Set(); for (let index = 0; index <= normalized.length - 3; index += 1) grams.add(normalized.slice(index, index + 3)); return grams; }
function similarity(a, b) { const first = generateTrigrams(a); const second = generateTrigrams(b); const intersection = [...first].filter((gram) => second.has(gram)).length; const union = new Set([...first, ...second]).size; return union ? intersection / union : 0; }
function normalizeText(text) { return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim(); }
function parseOptions(value) { return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => { const match = line.match(/^([A-Ea-e])[\).、:：\s-]+(.+)$/); return { label: match ? match[1].toUpperCase() : String.fromCharCode(65 + index), text: match ? match[2].trim() : line }; }); }
function formatOptions(options) { return (options || []).map((option, index) => { if (typeof option === "string") return option; const label = option.label || String.fromCharCode(65 + index); return `${label}. ${option.text || ""}`.trim(); }).filter(Boolean).join("\n"); }
function parseTags(value) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean); }
function loadQuestions() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function persistQuestions() { localStorage.setItem(STORAGE_KEY, JSON.stringify(questions)); }
function exportQuestionsPDF() {
  const selected = getFilteredLibraryQuestions();
  if (!selected.length) {
    alert("当前筛选条件下没有题目可以导出。");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("浏览器拦截了打印窗口，请允许弹窗后再试一次。");
    return;
  }

  const pages = selected.map((question, index) => renderPDFQuestionPage(question, index + 1)).join("\n");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Imperial CSP ACT 复习题 PDF</title>
  <script>
    window.MathJax = {
      tex: { inlineMath: [["$", "$"], ["\\\\(", "\\\\)"]], displayMath: [["$$", "$$"], ["\\\\[", "\\\\]"]], processEscapes: true },
      svg: { fontCache: "global" }
    };
  <\/script>
  <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"><\/script>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17212b; font-family: Arial, "Microsoft YaHei", sans-serif; line-height: 1.45; }
    .pdf-page { min-height: 260mm; page-break-after: always; break-after: page; padding: 0; }
    .pdf-page:last-child { page-break-after: auto; break-after: auto; }
    .pdf-header { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 8px; border-bottom: 1px solid #d8e0e5; font-size: 12px; color: #5f6f7a; }
    h1 { margin: 14px 0 10px; font-size: 20px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .chip { padding: 3px 8px; border-radius: 999px; background: #edf3f1; color: #2e5752; font-size: 11px; font-weight: 700; }
    .question-image { display: block; width: 100%; max-height: 115mm; margin: 8px auto 14px; object-fit: contain; border: 1px solid #d8e0e5; border-radius: 6px; }
    .block { margin-top: 10px; padding: 10px 12px; border: 1px solid #d8e0e5; border-radius: 6px; background: #fbfcfc; white-space: pre-wrap; overflow-wrap: anywhere; }
    .block h2 { margin: 0 0 6px; font-size: 14px; }
    .question-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    mjx-container { max-width: 100%; overflow-x: auto; overflow-y: hidden; }
    svg { max-width: 100%; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
${pages}
<script>
  window.addEventListener("load", () => {
    const done = window.MathJax?.typesetPromise ? window.MathJax.typesetPromise() : Promise.resolve();
    done.finally(() => window.setTimeout(() => window.print(), 400));
  });
<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function renderPDFQuestionPage(question, number) {
  const chips = [question.course, question.topic, question.type, question.difficulty, ...(question.tags || [])]
    .filter(Boolean)
    .map((label) => `<span class="chip">${escapeHtml(label)}</span>`)
    .join("");
  const options = formatOptions(question.options || []);
  const answerParts = [
    question.correctAnswer ? `正确选项：${question.correctAnswer}` : "",
    question.answer ? `答案：\n${question.answer}` : ""
  ].filter(Boolean).join("\n\n");

  return `<section class="pdf-page">
    <div class="pdf-header"><span>Imperial CSP ACT 复习</span><span>题目 ${number} / ${getFilteredLibraryQuestions().length}</span></div>
    <h1>题目 ${number}</h1>
    <div class="chips">${chips}</div>
    ${question.imageData ? `<img class="question-image" src="${question.imageData}" alt="题目原图">` : ""}
    <div class="block"><h2>题干</h2><div class="question-text">${mathHTMLForPrint(question.text)}</div></div>
    ${options ? `<div class="block"><h2>选项</h2>${mathHTMLForPrint(options)}</div>` : ""}
    ${answerParts ? `<div class="block"><h2>答案</h2>${mathHTMLForPrint(answerParts)}</div>` : ""}
    ${question.explanation ? `<div class="block"><h2>解析</h2>${mathHTMLForPrint(question.explanation)}</div>` : ""}
  </section>`;
}

function mathHTMLForPrint(value) {
  return escapeHtml(wrapBareLatex(cleanAIText(value || ""))).replace(/\n/g, "<br>");
}
function exportQuestions() { const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `final-review-question-bank-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); }
function toCloudQuestion(question) { return { course: question.course, topic: question.topic, type: question.type, difficulty: question.difficulty, text: cleanAIText(question.text), image_data: question.imageData || "", options: cleanOptions(question.options || []), correct_answer: question.correctAnswer || "", answer: cleanAIText(question.answer), explanation: cleanAIText(question.explanation), tags: question.tags, reviewed: question.reviewed, updated_at: question.updatedAt }; }
function fromCloudQuestion(question) { return { id: question.id, course: question.course, topic: question.topic, type: question.type, difficulty: question.difficulty, text: cleanAIText(question.text), imageData: question.image_data || "", options: cleanOptions(question.options || []), correctAnswer: question.correct_answer || "", answer: cleanAIText(question.answer || ""), explanation: cleanAIText(question.explanation || ""), tags: question.tags || [], reviewed: Boolean(question.reviewed), createdAt: question.created_at, updatedAt: question.updated_at }; }
function showFormMessage(message) { els.duplicatePreview.hidden = false; els.duplicatePreview.textContent = message; }
function setStatus(message) { els.ocrStatus.textContent = message; }
function fileToResizedDataUrl(file) { return new Promise((resolve, reject) => { const image = new Image(); const reader = new FileReader(); reader.onload = () => { image.onload = () => { const maxSide = 1800; const scale = Math.min(1, maxSide / Math.max(image.width, image.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL("image/jpeg", 0.88)); }; image.onerror = reject; image.src = reader.result; }; reader.onerror = reject; reader.readAsDataURL(file); }); }
function confirmDuplicateQuestion(candidate) {
  const matches = findSimilarQuestions(getQuestionStemText(candidate), editingId, 0.5).slice(0, 3);
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
          ${best.question.imageData ? `<img class="duplicate-modal-image" src="${best.question.imageData}" alt="已有题目原图">` : `<p>${escapeHtml(best.question.text).slice(0, 500)}</p>`}
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
function buildExplanationWithContext(data) {
  const parts = [];
  if (data.chapter || data.knowledgePoint || data.sourceRefs?.length) {
    parts.push([
      data.chapter ? `章节：${data.chapter}` : "",
      data.knowledgePoint ? `知识点：${data.knowledgePoint}` : "",
      data.sourceRefs?.length ? `课件参考：${data.sourceRefs.join("；")}` : ""
    ].filter(Boolean).join("\n"));
  }
  if (data.explanation || data.notes) parts.push(data.explanation || data.notes);
  return parts.filter(Boolean).join("\n\n");
}

function inferTopicFromRefs(refs) {
  const first = refs[0];
  if (!first) return "";
  if (typeof first === "string") return first;
  return first.ref || [first.lecture, first.title, first.page ? `page ${first.page}` : ""].filter(Boolean).join(" ");
}

function mergeTags(existingValue, values) {
  const current = parseTags(existingValue);
  const next = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[;,，；]/))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.length <= 80);
  return [...new Set([...current, ...next])].join(", ");
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
function cleanOptions(options) {
  return (options || []).map((option, index) => {
    if (typeof option === "string") {
      return { label: String.fromCharCode(65 + index), text: cleanAIText(option) };
    }
    return {
      ...option,
      label: option.label || String.fromCharCode(65 + index),
      text: cleanAIText(option.text || "")
    };
  });
}
function cleanAIText(value) {
  return repairLatexEscapes(String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t(?!ext|heta|imes)/g, "  "))
    .replace(/\$\s*\$/g, "")
    .replace(/\\\(\s*\\\)/g, "")
    .replace(/\\\[\s*\\\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function repairLatexEscapes(value) {
  return String(value || "")
    .replace(/extCRB/g, "\\text{CRB}")
    .replace(/extSNRimesL/g, "\\text{SNR}\\times L")
    .replace(/extSNR/g, "\\text{SNR}")
    .replace(/(?<=[[\s])heta(?=[]\s])/g, "\\theta")
    .replace(/(^|[^\\A-Za-z])ext([A-Z][A-Za-z]*?)imes([A-Z][A-Za-z]*)(?=\s|[$}()[\],.;:+\-*/=]|$)/g, (match, prefix, textPart, rhs) => `${prefix}\\text{${textPart}}\\times ${rhs}`)
    .replace(/(^|[^\\A-Za-z])ext([A-Z][A-Za-z]*)(?=\s|[$}()[\],.;:+\-*/=]|$)/g, (match, prefix, textPart) => `${prefix}\\text{${textPart}}`)
    .replace(/(^|[^\\A-Za-z])(?:text|ext)\s*\{/g, (match, prefix) => `${prefix}\\text{`)
    .replace(/(^|[^\\A-Za-z])(?:frac|rac)\s*\{/g, (match, prefix) => `${prefix}\\frac{`)
    .replace(/(^|[^\\A-Za-z])sqrt\s*\{/g, (match, prefix) => `${prefix}\\sqrt{`)
    .replace(/(^|[^\\A-Za-z])heta(?=\s|[$}()[\],.;:+\-*/=]|$)/g, (match, prefix) => `${prefix}\\theta`)
    .replace(/(^|[^\\A-Za-z])imes(?=\s|[$}()[\],.;:+\-*/=]|$)/g, (match, prefix) => `${prefix}\\times`)
    .replace(/(^|[^\\A-Za-z])(?:quad|qquad)(?=\s|$)/g, (match, prefix) => `${prefix}\\${match.slice(prefix.length)}`)
    .replace(/(^|[^\\A-Za-z])Lambda(?=\s|[$}()[\],.;:+\-*/=]|$)/g, (match, prefix) => `${prefix}\\Lambda`);
}
function setMathHTML(element, value, highlight = "") {
  const prepared = wrapBareLatex(cleanAIText(value || ""));
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










































