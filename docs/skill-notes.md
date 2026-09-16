# 无名杀技能编写约定（skill-notes.md）

> 用途：每个新对话开场先读本文件，即可跳过"探索核心源码"这一步，直接写技能。
> 行号是编写本文件时核对到的位置，核心更新后可能偏移，只作线索用。

## 0. 用法

新对话第一句话：

```
先读 docs/skill-notes.md，按里面的约定做。

路径：apps/core/character/<包>/skill.js
新技能：<技能ID>
现有代码：（把要改的技能完整贴出，或写"新增"）
目标描述：<技能ID>_info: "……"
依赖：标记用 <前缀>_*；同伴技能叫 a/b/c；storage key 是 xxx
要求：不核对核心 API，只输出改动后的函数/字段
```

一次要把多个技能说完就一起说（同一角色/同一套标记的尤其适合放同一条消息）。

## 1. 输出约定（务必遵守，能省大量 token）

- **默认不改文件**，改动一律直接输出在对话框里；只有用户明确说"写进文件""改文件"之类的指令时才落盘。
- **只输出改动的函数/字段**，不要整段技能、不要改动清单表格、不要解释。
- 需要完整版时再说"贴完整版"。
- 不要主动"顺便核对核心 API"；需要核对时明确说"这次核对一下 API"。
- 代码用 **tab 缩进**，注释用中文 `//`，与核心文件保持一致。
- 说明文字要短，只讲"为什么这么改"和"哪里需要你确认"。

## 2. 已确认的核心 API 速查

### 2.1 技能骨架

```js
技能ID: {
    audio: 2,                 // 数字 = 本技能有 N 条语音，文件 audio/skill/<技能ID>1.mp3…；
                              // 字符串 = 复用别的技能音效，如 audio: "xinfu_falu"
    enable: "chooseToUse" | "phaseUse" | ["chooseToUse", "chooseToRespond"] | {player: [...], global: [...]},
    trigger: { player: "damageEnd", source: "damageBegin1", target: "useCardToTargeted", global: "judge" },
    forced: true,             // 强制发动；锁定技只需 forced: true（locked 判定见 Skill.d.ts:647）
    usable: 1,                // 每回合 N 次，统计在 player.getStat("skill")
    frequent: true,           // 可反复发动、不计入"已发动"
    filter(event, player, name) {},   // 能否发动（name = 触发时机名）
    prompt2: "……",            // 发动提示第二行
    check(event, player) {},  // 触发技的 AI 是否发动
    logTarget: "player",      // 战报目标
    async content(event, trigger, player) {},
    async cost(event, trigger, player) { event.result = await player.chooseXxx().forResult(); },
    mod: { cardUsable/targetInRange/playerEnabled/cardname/... },
    group: ["a", "b"],        // 常驻挂载其它技能
    subSkill: { x: {...} },   // 展开为 <技能ID>_x
    ai: {...},
    intro: { content(storage, player) {} },
    onremove(player, skill) {},
}
```

### 2.2 触发时机（useCard 流程）

`useCardToPlayer`(step6) → `useCardToTarget`(step7) → `useCardToPlayered`(step9) → `useCardToTargeted`(step10)
（content.ts:10147-10174）

- **"成为牌的目标后" 用 `target: "useCardToTargeted"`**（核心 165 处），"指定目标时" 用 `useCardToTarget`（64 处）。
- `filter(event, player, name)` 的 `name` 与该时机一致，可用来分流多个 trigger。

### 2.3 标记（mark）

- **标记 ID = 技能ID + "_" + 子技能名**（`subSkill: {spade: {...}}` 自动展开为 `x_spade`）。
- 标记的显示：`marktext`（如 `"♠︎️"`）与 `intro: {name: "紫薇", content: "mark"}` 写在对应子技能里。
- `player.addMark(id)` / `removeMark(id, 1)` / `clearMark(id)` / `hasMark(id)` / `countMark(id)`
  - **addMark / removeMark 会自动打战报**（用 `intro.name`），例如"获得了1个【紫薇】"，**不要手写 game.log**。
  - `clearMark` = 清空全部；表达"弃置一枚"用 `removeMark(id, 1)`。
  - `removeMark` 数量归零时会自动收起标记图案。
- `player.unmarkSkill(id)`：**若无 `intro.onunmark` 会 `delete storage[id]`** —— 这是"效果只生效一次/被消耗掉"的标准手法；想做成"整回合持续生效"就**不要**调用它（和 `usable: 1` 一起出现时通常就是"只限一次"）。
- 列表型记录（花色/牌名数组）：`getStorage(id)` / `setStorage(id, list, true)` / `markAuto(id, [x])` / `unmarkAuto(id, [x])`。

### 2.4 视为技（viewAs）

- 有实体牌消耗：`viewAs` + `filterCard` + `position`（"h"/"he"/"hes"/"hse"）。
- **无实体牌消耗**（标准写法）：

  ```js
  filterCard: () => false,
  selectCard: -1,
  viewAs: { name: "tao", isCard: true },
  ```

  例：`jsrg/skill.js:7725 jsrgzhangdeng_jiu`、`sb/skill.js:7699 sbrende_use`、`sp/skill.js:12758 olxvfa_remove`。
- 启用条件放 `viewAsFilter(player)`（4 处会读：`player.js:3090`、`library/index.js:11216`、`player.js:13886`、`content.ts:13090`）或现代写法 `filter(event, player)`。
- `popname: true` 让飘字显示"视为后的牌名"，`log: false` + `precontent` 里手动 `logSkill`。
- **chooseButton 类视为技**：`chooseButton: {dialog, check, backup, prompt}`
  - `dialog` 返回 `ui.create.dialog("名", [list, "vcard"], "hidden")`；`[list,"vcard"]` 的按钮 `link` 就是 `[类型, 副类型, 牌名, 属性]` → `button.link[2]/[3]`。
  - `dialog.direct = true`：可选项数量等于需选数量时自动确定。
  - `backup` 返回的配置会替换事件的 `filterCard`，但**不会**清掉事件已有的 `filterTarget`（`gameEvent.ts:800-831`）——濒死救助等场合靠这点沿用外层目标限制。
  - `position` 与 `filterCard` 一起限制可消耗的牌区。

### 2.5 摸牌 / 找牌 / 放回牌堆

- 找符合条件的牌：`get.cardPile(filter)`（**牌堆→弃牌堆**，从顶往下）、`get.cardPile2(filter, start)`（**仅牌堆**，`start` 可为 `"top"/"bottom"/"random"`）。
- 拿到手：`await player.gain(cards, "draw")`（摸牌动画）/ `"gain2"`（获得动画）。
- 观看牌堆顶 N 张再放回：`get.cards(N, true)` → `await game.cardsGotoOrdering(cards)` → `player.chooseToGuanxing(N)` 或自己用 `chooseToMove`。
- **chooseToMove 三分组（顶/底/获得）**：

  ```js
  player.chooseToMove(true)
      .set("list", [["牌堆顶", cards], ["牌堆底"], ["获得"]])
      .set("filterOk", moved => {...})                 // moved[i] = 第 i 组的牌；false 时不给"确定"按钮
      .set("filterMove", (from, to, moved) => {...})   // to 为数字=分组下标，为牌=插到该牌前
      .set("processAI", list => [顶层数组, 底层数组, 获得数组])
  ```

  `list.length > 2` 会自动切全高布局。
- **收尾放回**（顶/底一次搞定）：

  ```js
  const top = result.moved[0].slice(0).reverse();
  const bottom = result.moved[1].slice(0);
  await game.cardsGotoPile(top.concat(bottom), ["top_cards", top], (event, card) =>
      event.top_cards.includes(card) ? ui.cardPile.firstChild : null);
  game.addCardKnower(top, player);   // 让玩家看得见自己排的牌序
  ```

  回调返回 `ui.cardPile.firstChild` = 插到牌堆顶；返回 `null` = 默认 `appendChild` → 牌堆底。

### 2.6 数值 / 时序 / 其他

- 伤害加成：`trigger.num += n`（`source: "damageBegin1"`）等。
- 改判：在 `global: "judge"` 的 content 里写 `trigger.fixedResult = {suit, color, number}`；`trigger.judge(card)` 是 judge 事件上的取值函数，可用于 AI 比较改判收益。
- `player.addTempSkill(id)` 不带 expire = `{global: ["phaseAfter","phaseBeforeStart"]}`，即**本回合结束移除**（`phaseAfter` 是整轮阶段走完后触发）；`addTempSkill(id, "phaseAfter")` 等价写法。
- 濒死救助：`_save` 会把 `filterCard` 换成 `lib.filter.cardSavable`，且只有 `player.canSave(死者)` 为真才询问；`canSave` 会看 `hasSkillTag("save")` 或（`savable` 的牌 + `hasUsableCard`）。
- `get.is.damageCard(card)` = 有 damage 标签且（默认）排除延时锦囊。
- `get.type("未知名")` 返回 `undefined`，不抛错；`get.suit(card, observer)` 的第二个参数是"参考玩家"。
- `lib.suit = ["club","spade","diamond","heart"]`（`lib.suits` 多一个 `"none"`）。
- `Array.prototype.addArray(undefined)` **会抛异常**，遇到 `event.getl(player)?.cards2` 一律 `|| []`。

### 2.7 AI 字段

- `ai.order`（发动优先度）、`ai.combo`（组合技）、`ai.threaten`、`ai.maixie`、`ai.result.{player,target}`、`ai.effect.{player,target}`、`ai.skillTagFilter`。
- **`hasSkillTag("save"/"respondSha"/"respondShan"/"respondTao"/...) 读的是 `ai.save`、`ai.respondSha` 这类同级字段**，不是 `ai.tag.xxx`；`ai.tag` 只对 `get.tag(牌, 标签)` 生效。
- `hiddenCard(player, name)` 只被 `player.hasUsableCard` / `player.hasWuxie` 使用（`player.js:3113`、`13890`），用于让"他有没有杀/闪/无懈/桃"的判断把视为技算进去；它返回 true 不代表此刻真能用，还要过 `filter`。
- 无实体的视为技要记得给 AI 补 `respondSha/respondShan/respondTao/save` + `skillTagFilter`。

## 3. 常用"套路"对照

| 需求 | 写法 |
| --- | --- |
| 每回合限一次 | `usable: 1`（+ `!player.getStat().skill.<id>` 可作防御性重复判断） |
| 整回合持续的增益 | `addTempSkill("x_effect")`，**不要** unmarkSkill；配 `intro: {content: "..."}` 显示 |
| 只生效一次的增益 | 同上，但在 content 里 `player.unmarkSkill("x_effect")`（会清 storage） |
| 无牌消耗的视为技 | `filterCard: () => false, selectCard: -1, viewAs: {..., isCard: true}` |
| 从牌堆挑特定牌 | `get.cardPile(filter)` / `get.cardPile2(filter, "random")` |
| 看 N 张 + 获得 + 其余放顶/底 | `get.cards(N, true)` + `cardsGotoOrdering` + `chooseToMove` 三分组 + `cardsGotoPile(..., ["top_cards", top], cb)` |
| 锁定技 | `forced: true`（无需写 `locked`） |
| 视为技的启用条件 | `viewAsFilter(player)` 或 `filter(event, player)` |

## 4. 已确认的领域约定（持续追加）

- 法箓系（`old_falu`）：标记 `old_falu_spade/heart/club/diamond` = 紫薇♠ / 玉清♥ / 后土♣ / 勾陈♦，游戏开始四枚全给，被消耗后靠"成为牌的目标"与"牌被弃置"补回。
- 点化系（`old_dianhua`）：看四张 → 拿一张"花色已被法箓记录"的牌（= 有对应标记）→ 其余放顶或底；"有可获得的牌就必须拿一张"。
- 真仪系（`old_zhenyi`）：消耗标记型四选项；文案统一用"弃置一枚「X」"；`removeMark(id, 1)`。
- 描述文本里的量词：标记用"枚"，牌用"张"。

## 5. 写技能时的自查清单

1. 触发时机对不对（`useCardToTarget` / `useCardToTargeted` / `damageBegin1` / `damageEnd` …）？
2. 消耗是"标记"还是"牌"？标记用 `removeMark(id, 1)`；牌用 `filterCard` + `position`。
3. 效果持续到"本次结算"还是"本回合"？后者用 `addTempSkill`。
4. `filter` 里是否把"没有可发动条件"的情况挡掉了（避免残局刷一堆无效询问）？
5. AI：`order` / `combo` / `skillTagFilter` / `respondXxx` / `maixie` 是否需要补？
6. 描述与实现是否一一对应（尤其是"下一张 / 每张""每回合 / 每阶段""一枚 / 一张"）？
