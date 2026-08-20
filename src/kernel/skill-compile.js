/**
 * Skill 编译器：把 SKILL.md 翻译成结构化的环节与门禁定义。
 *
 * 改造自 ref skill-adapter.js：
 * 1) 删除 buildRuleFunctions(存根生成)
 * 2) extractGates 增识别行 `严格度: block|warn|info`(可缺省,缺省沿用 inferSeverity)
 * 3) 返回 {stages, gates, errors}(prompts 相关逻辑保留但仅产缺省组,见 §3.3b 双源规则)
 */

/**
 * 编译 SKILL.md。
 *
 * @param {string} mdText - SKILL.md 内容
 * @returns {object} { stages, gates, errors }
 */
export function compileSkill(mdText) {
  const { frontmatter, body } = parseSkillMarkdown(mdText);

  const stages = extractStages(body);
  const gatesRaw = extractGates(body);
  const errors = validate({ stages, gates: gatesRaw });

  if (errors.length > 0) {
    return { stages: [], gates: [], errors };
  }

  const stagesBuilt = buildStages(stages, gatesRaw);
  const gatesBuilt = buildGates(gatesRaw, stages);

  return { stages: stagesBuilt, gates: gatesBuilt, errors: [] };
}

/**
 * 解析 skill markdown：frontmatter + body。
 */
function parseSkillMarkdown(content) {
  const lines = content.split('\n');
  let inFront = false;
  let frontLines = [];
  let bodyLines = [];
  let frontClosed = false;

  for (const line of lines) {
    if (line.trim() === '---') {
      if (!inFront && !frontClosed) {
        inFront = true;
        continue;
      } else if (inFront) {
        inFront = false;
        frontClosed = true;
        continue;
      }
    }
    if (inFront) {
      frontLines.push(line);
    } else if (frontClosed) {
      bodyLines.push(line);
    } else {
      // No frontmatter - add directly to body
      bodyLines.push(line);
    }
  }

  const frontmatter = {};
  for (const line of frontLines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }

  return { frontmatter, body: bodyLines.join('\n') };
}

/**
 * 提取环节定义。
 * 格式：## 环节N：名称
 * - 目的：...
 * - 产物：...
 */
function extractStages(body) {
  const stages = [];
  const lines = body.split('\n');
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\s*环节(\d+)[:：]\s*(.+)$/);
    if (m) {
      if (current) stages.push(current);
      current = { id: Number(m[1]), name: m[2].trim(), purpose: '', deliverables: '' };
    } else if (current) {
      const purpose = line.match(/^-\s*目的[:：]\s*(.+)$/);
      const deliverables = line.match(/^-\s*产物[:：]\s*(.+)$/);
      if (purpose) current.purpose = purpose[1].trim();
      if (deliverables) current.deliverables = deliverables[1].trim();
    }
  }
  if (current) stages.push(current);
  return stages;
}

/**
 * 提取门禁列表。
 * 格式：### N.M 门禁名称
 * 判据类型: auto|human
 * 严格度: block|warn|info (可缺省)
 */
function extractGates(body) {
  const gates = [];
  const lines = body.split('\n');
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^###\s*(\d+)\.(\d+)\s+(.+)$/);
    if (m) {
      if (current) gates.push(current);
      const stageNum = Number(m[1]);
      const orderNum = Number(m[2]);
      current = {
        id: `${m[1]}.${m[2]}`,
        stage: stageNum,
        order: orderNum,
        description: m[3].trim(),
        type: null,
        severity: null,
        hint: '',
        detectLogic: '',
        question: '',
        evidence: '',
      };
    } else if (current) {
      const type = line.match(/^判据类型[:：]\s*(auto|human)/);
      const severity = line.match(/^严格度[:：]\s*(block|warn|info)/);
      // 「提示」是红灯那一行下面的「怎么办」。不收的话报错只有前两段
      // （哪条没过、为什么没过），第三段"接下来做什么"就是空的（§2.5 报错三段式）。
      const hint = line.match(/^提示[:：]\s*(.+)$/);
      const detect = line.match(/^如何探测[:：]\s*(.+)$/);
      const question = line.match(/^提问[:：]\s*(.+)$/);
      const evidence = line.match(/^需要凭据[:：]\s*(.+)$/);
      if (type) current.type = type[1];
      if (severity) current.severity = severity[1];
      if (hint) current.hint = hint[1].trim();
      if (detect) current.detectLogic += detect[1].trim() + '\n';
      if (question) current.question = question[1].trim();
      if (evidence) current.evidence = evidence[1].trim();
    }
  }
  if (current) gates.push(current);
  return gates;
}

/**
 * 验证完整性。
 */
function validate({ stages, gates }) {
  const errors = [];

  if (stages.length < 3) errors.push('环节数少于 3 个');
  if (stages.length > 12) errors.push('环节数超过 12 个');

  for (const s of stages) {
    if (!s.purpose) errors.push(`环节${s.id} "${s.name}" 缺少目的描述`);
    if (!s.deliverables) errors.push(`环节${s.id} "${s.name}" 缺少产物描述`);
    const sGates = gates.filter((g) => g.stage === s.id);
    if (sGates.length < 2) errors.push(`环节${s.id} "${s.name}" 门禁少于 2 条`);
  }

  for (const g of gates) {
    if (!g.type) {
      errors.push(`门禁 ${g.id} 没有标记判据类型（auto|human）`);
    }
  }

  return errors;
}

/**
 * 构建 stages 数据结构。
 */
function buildStages(stages, gates) {
  return stages.map((s) => {
    const sGates = gates.filter((g) => g.stage === s.id);
    return {
      id: s.id,
      key: `s${s.id}`,
      name: s.name,
      oneLiner: s.purpose,
      artifacts: s.deliverables.split(/[,，、]/).map((a) => a.trim()).filter(Boolean),
      gates: sGates.map((g) => g.id),
    };
  });
}

/**
 * 构建 gates 数据结构（带缺省提问组）。
 */
function buildGates(gates, stages) {
  return gates.map((g) => {
    const stage = stages.find((s) => s.id === g.stage);
    return {
      id: g.id,
      stage: g.stage,
      mode: g.type,
      severity: g.severity || inferSeverity(g, stage),
      desc: g.description,
      hint: g.hint,
      // 生成缺省提问组（human 门禁）
      defaultPrompt: g.type === 'human' ? buildDefaultPrompt(g) : null,
    };
  });
}

/**
 * 推断严格度。
 */
function inferSeverity(gate, stage) {
  // 第一个环节的前 2 条 → block (order 1, 2)
  if (stage && stage.id === 1 && gate.order <= 2) return 'block';
  // 明确标记了"必须"的 → block
  if (gate.description.includes('必须') || gate.description.includes('不得')) return 'block';
  // 其余 → warn
  return 'warn';
}

/**
 * 构建缺省提问组（human 门禁）。
 */
function buildDefaultPrompt(gate) {
  const asks = [];

  if (gate.question) {
    asks.push({ key: 'done', q: gate.question, why: '需要确认' });
  }

  if (gate.evidence) {
    asks.push({ key: 'evidence', q: gate.evidence, why: '需要留档' });
  }

  // 如果两者都没有，至少生成一个基本确认问题
  if (asks.length === 0) {
    asks.push({ key: 'confirm', q: `${gate.description}完成了吗？`, why: '需要确认' });
  }

  return {
    id: gate.id,
    topic: gate.description,
    stage: gate.stage,
    lead: gate.question || `关于「${gate.description}」`,
    blockUntilAnswered: false,
    needs: [],
    asks,
  };
}
