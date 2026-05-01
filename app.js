const STORAGE_KEY = "final-review-question-bank-v1";

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
  ocrButton: document.getElementById("ocrButton"),
  ocrStatus: document.getElementById("ocrStatus"),
  courseInput: document.getElementById("courseInput"),
  topicInput: document.getElementById("topicInput"),
  typeInput: document.getElementById("typeInput"),
  difficultyInput: document.getElementById("difficultyInput"),
  questionInput: document.getElementById("questionInput"),
  answerInput: document.getElementById("answerInput"),
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

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

els.imageInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  selectedImage = file;
  els.previewImage.src = URL.createObjectURL(file);
  els.previewImage.hidden = false;
  els.ocrStatus.textContent = "图片已选择，可以开始识别";
});

els.ocrButton.addEventListener("click", runOcr);
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

renderAll();
initCloudMode();

async function initCloudMode() {
  const config = window.APP_CONFIG || {};
  const hasSupabaseConfig = config.SUPABASE_URL && config.SUPABASE_ANON_KEY;
  if (!hasSupabaseConfig || !window.supabase) return;

  supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  dbMode = "cloud";
  els.ocrStatus.textContent = "已连接云端题库";

  await fetchCloudQuestions();
  supabaseClient
    .channel("questions-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "questions" }, fetchCloudQuestions)
    .subscribe();
}

async function fetchCloudQuestions() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("questions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    els.ocrStatus.textContent = "云端读取失败，请检查 Supabase 表和权限";
    return;
  }

  questions = data.map(fromCloudQuestion);
  renderAll();
}

function showView(name) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  els.views.forEach((view) => view.classList.remove("active"));
  document.getElementById(`${name}View`).classList.add("active");
  if (name === "duplicates") renderDuplicates();
}

async function runOcr() {
  if (!selectedImage) {
    els.ocrStatus.textContent = "请先选择一张图片";
    return;
  }
  if (!window.Tesseract) {
    els.ocrStatus.textContent = "OCR 库没有加载成功，请检查网络后刷新";
    return;
  }

  els.ocrButton.disabled = true;
  els.ocrStatus.textContent = "正在识别...";

  try {
    const result = await Tesseract.recognize(selectedImage, "eng+chi_sim", {
      logger: (message) => {
        if (message.status === "recognizing text") {
          const progress = Math.round(message.progress * 100);
          els.ocrStatus.textContent = `正在识别 ${progress}%`;
        }
      }
    });
    els.questionInput.value = result.data.text.trim();
    els.ocrStatus.textContent = "识别完成，建议检查错字";
    renderDuplicatePreview();
  } catch (error) {
    els.ocrStatus.textContent = "识别失败，可以先手动粘贴题目";
    console.error(error);
  } finally {
    els.ocrButton.disabled = false;
  }
}

async function saveQuestionFromForm() {
  const text = els.questionInput.value.trim();
  if (!text) {
    els.duplicatePreview.hidden = false;
    els.duplicatePreview.textContent = "题目内容不能为空。";
    return;
  }

  const now = new Date().toISOString();
  const existing = editingId ? questions.find((question) => question.id === editingId) : null;
  const question = {
    id: editingId || crypto.randomUUID(),
    course: els.courseInput.value.trim() || "未分类课程",
    topic: els.topicInput.value.trim() || "未分类章节",
    type: els.typeInput.value,
    difficulty: els.difficultyInput.value,
    text,
    answer: els.answerInput.value.trim(),
    explanation: existing?.explanation || els.questionInput.dataset.explanationDraft || "",
    tags: parseTags(els.tagsInput.value),
    reviewed: existing?.reviewed || false,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  if (dbMode === "cloud") {
    await saveCloudQuestion(question);
  } else if (editingId) {
    questions = questions.map((item) => (item.id === editingId ? question : item));
  } else {
    questions.unshift(question);
  }

  if (dbMode === "local") persistQuestions();
  resetForm();
  if (dbMode === "local") renderAll();
  showView("library");
}

async function saveCloudQuestion(question) {
  const payload = toCloudQuestion(question);
  const request = editingId
    ? supabaseClient.from("questions").update(payload).eq("id", editingId)
    : supabaseClient.from("questions").insert(payload);

  const { error } = await request;
  if (error) {
    els.duplicatePreview.hidden = false;
    els.duplicatePreview.textContent = `云端保存失败：${error.message}`;
    throw error;
  }
}

function generateExplanationDraft() {
  const text = els.questionInput.value.trim();
  if (!text) {
    els.duplicatePreview.hidden = false;
    els.duplicatePreview.textContent = "先填入题目内容，再生成解析草稿。";
    return;
  }

  const answer = els.answerInput.value.trim();
  const draft = [
    "解析草稿",
    "",
    "1. 先识别题目考察的核心知识点。",
    `   本题与「${els.topicInput.value.trim() || "当前章节"}」相关，需要把概念、条件和题目要求分开看。`,
    "",
    "2. 解题思路。",
    "   逐句找出关键词，判断题目是在问定义、比较、计算步骤，还是实际场景中的取舍。",
    "",
    answer ? `3. 参考答案。\n   ${answer}` : "3. 参考答案。\n   这里还没有填写答案，建议先自己作答，再补充标准答案。",
    "",
    "4. 易错点。",
    "   不要只背结论，要能解释为什么其他选项或做法不合适。",
    "",
    "AI 提示词",
    "请基于下面这道复习题生成严谨但易懂的中文解析，包括考点、解题步骤、正确答案、易错点和一句记忆提示：",
    text
  ].join("\n");

  navigator.clipboard?.writeText(draft).catch(() => {});
  els.duplicatePreview.hidden = false;
  els.duplicatePreview.textContent = "已生成解析草稿，并尝试复制 AI 提示词。保存题目后可以在题库中继续查看。";
  const existing = editingId ? questions.find((question) => question.id === editingId) : null;
  if (existing) {
    existing.explanation = draft;
    existing.updatedAt = new Date().toISOString();
    persistQuestions();
    renderAll();
  } else {
    els.answerInput.value = answer;
    els.questionInput.dataset.explanationDraft = draft;
  }
}

function resetForm() {
  editingId = null;
  selectedImage = null;
  els.imageInput.value = "";
  els.previewImage.hidden = true;
  els.previewImage.removeAttribute("src");
  els.ocrStatus.textContent = "等待上传图片";
  els.courseInput.value = "";
  els.topicInput.value = "";
  els.typeInput.value = "选择题";
  els.difficultyInput.value = "普通";
  els.questionInput.value = "";
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
    const haystack = normalizeText([
      question.course,
      question.topic,
      question.type,
      question.difficulty,
      question.text,
      question.answer,
      question.explanation,
      question.tags.join(" ")
    ].join(" "));

    const matchesQuery = !query || haystack.includes(query);
    const matchesCourse = !course || question.course === course;
    const matchesStatus =
      !status ||
      (status === "explained" && question.explanation) ||
      (status === "todo" && !question.explanation) ||
      (status === "reviewed" && question.reviewed);

    return matchesQuery && matchesCourse && matchesStatus;
  });

  els.questionList.innerHTML = "";
  if (!filtered.length) {
    els.questionList.innerHTML = `<p class="empty-state">还没有符合条件的题目。</p>`;
    return;
  }

  filtered.forEach((question) => {
    els.questionList.append(renderQuestionCard(question));
  });
}

function renderQuestionCard(question) {
  const node = els.template.content.cloneNode(true);
  const card = node.querySelector(".question-card");
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
  answer.textContent = question.answer ? `答案：\n${question.answer}` : "";
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
  els.answerInput.value = question.answer;
  els.tagsInput.value = question.tags.join(", ");
  els.saveQuestionButton.textContent = "更新题目";
  renderDuplicatePreview();
  showView("upload");
}

async function toggleReviewed(id) {
  if (dbMode === "cloud") {
    const question = questions.find((item) => item.id === id);
    if (!question) return;
    const { error } = await supabaseClient
      .from("questions")
      .update({ reviewed: !question.reviewed, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) alert(`更新失败：${error.message}`);
    return;
  }

  questions = questions.map((question) =>
    question.id === id ? { ...question, reviewed: !question.reviewed, updatedAt: new Date().toISOString() } : question
  );
  persistQuestions();
  renderAll();
}

async function deleteQuestion(id) {
  const question = questions.find((item) => item.id === id);
  if (!question) return;
  const confirmed = confirm("确定删除这道题吗？");
  if (!confirmed) return;

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

  const reveal = document.createElement("button");
  reveal.className = "primary-button";
  reveal.textContent = "显示答案和解析";

  const detail = document.createElement("div");
  detail.className = "answer-block";
  detail.hidden = true;
  detail.textContent = [
    question.answer ? `答案：\n${question.answer}` : "答案：暂无",
    question.explanation ? `\n\n解析：\n${question.explanation}` : "\n\n解析：暂无"
  ].join("");

  reveal.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    reveal.textContent = detail.hidden ? "显示答案和解析" : "隐藏答案和解析";
  });

  els.reviewPanel.append(meta, text, reveal, detail);
}

function renderDuplicatePreview() {
  const text = els.questionInput.value.trim();
  if (!text) {
    els.duplicatePreview.hidden = true;
    return;
  }

  const matches = findSimilarQuestions(text, editingId).slice(0, 3);
  if (!matches.length) {
    els.duplicatePreview.hidden = true;
    return;
  }

  const best = matches[0];
  els.duplicatePreview.hidden = false;
  els.duplicatePreview.textContent = `可能重复：与「${best.question.course} / ${best.question.topic}」相似度 ${Math.round(best.score * 100)}%。`;
}

function renderDuplicates() {
  const pairs = [];
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const score = similarity(questions[i].text, questions[j].text);
      if (score >= 0.55) {
        pairs.push({ first: questions[i], second: questions[j], score });
      }
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
      <div><strong>${escapeHtml(pair.first.course)} / ${escapeHtml(pair.first.topic)}</strong><p>${escapeHtml(pair.first.text)}</p></div>
      <div><strong>${escapeHtml(pair.second.course)} / ${escapeHtml(pair.second.topic)}</strong><p>${escapeHtml(pair.second.text)}</p></div>
    `;
    els.duplicateList.append(item);
  });
}

function findSimilarQuestions(text, excludeId) {
  return questions
    .filter((question) => question.id !== excludeId)
    .map((question) => ({ question, score: similarity(text, question.text) }))
    .filter((match) => match.score >= 0.55)
    .sort((a, b) => b.score - a.score);
}

function generateTrigrams(text) {
  const normalized = normalizeText(text);
  if (normalized.length <= 3) return new Set([normalized]);
  const grams = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function similarity(a, b) {
  const first = generateTrigrams(a);
  const second = generateTrigrams(b);
  const intersection = [...first].filter((gram) => second.has(gram)).length;
  const union = new Set([...first, ...second]).size;
  return union ? intersection / union : 0;
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function parseTags(value) {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function loadQuestions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistQuestions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
}

function exportQuestions() {
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `final-review-question-bank-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCloudQuestion(question) {
  return {
    course: question.course,
    topic: question.topic,
    type: question.type,
    difficulty: question.difficulty,
    text: question.text,
    answer: question.answer,
    explanation: question.explanation,
    tags: question.tags,
    reviewed: question.reviewed,
    updated_at: question.updatedAt
  };
}

function fromCloudQuestion(question) {
  return {
    id: question.id,
    course: question.course,
    topic: question.topic,
    type: question.type,
    difficulty: question.difficulty,
    text: question.text,
    answer: question.answer || "",
    explanation: question.explanation || "",
    tags: question.tags || [],
    reviewed: Boolean(question.reviewed),
    createdAt: question.created_at,
    updatedAt: question.updated_at
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
