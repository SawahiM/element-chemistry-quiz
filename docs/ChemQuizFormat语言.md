# ChemQuizFormat 1.5

ChemQuizFormat（CQF）是一种 JSON 题目格式语言。它保存“如何从物质数据库生成题目”，不保存题目实例。

定义文件：`public/question-formats.cqf.json`

## 核心字段

- `id`：稳定的格式标识。
- `questionType`：`single_choice` 或 `multiple_choice`。
- `generator`：数据绑定算法。
- `source.where`：观察记录筛选条件。
- `prompt`：文字与数据 token 组成的题干。
- `choices`：选项数量、正确项和干扰项策略。
- `reveal`：作答后显示的依据。

## 当前生成器

### `observation_to_color`

随机选择一条观察，以物质、状态和条件构造题干。每条观察的 `acceptedColorIds` 已经合并教材原始写法映射、范围中间色和标准术语的有向概括关系，其中任意一个均可作为正确答案。例如“浅黄色”允许回答“黄色”，但教材只写“黄色”时不反向接受“浅黄色”。最终四个颜色选项必须两两检查：只要任一方向存在“可接受”连接，两者就不能同时出现，即使二者都不是正确答案。“白色”和“无色”也继续禁止共现。若数据库中存在相同 `focusElement` 的其他物质，则以 80% 概率优先抽取最多两个相关颜色，以增加同一元素化合物之间的辨析难度。

### `color_to_substances`

先按 `acceptedColorIds` 建立颜色到物质的反向索引，选择至少对应三个物质的颜色，再从中抽取二至三个正确物质，并补足不接受该颜色的干扰物质。因而“黄色”题可以包含教材写作“浅黄色”的物质。颜色到物质题只判断每种物质是否接受题干给出的颜色，不比较物质选项彼此的颜色关系。白色题排除无色物质，无色题排除白色物质。题目每次现场生成。

### `color_to_one_substance`

随机选择一条颜色观察及其一个可接受标准术语作为唯一正确项，并给出四种物质。其他三种物质的全部观察均不接受目标术语；物质选项之间不执行标准颜色连接检查。干扰项仍优先匹配正确物质的 `focusElement`、观察类型和物态。

## 颜色语义数据

- `rawColorMappings`：教材原始写法到标准术语的映射；每个标准术语的 `sourceAliases` 提供反向索引。
- `colors[].acceptedColorIds`：标准术语之间“可概括为”的有向闭包。
- `observations[].acceptedColorIds`：原始写法映射和术语连接合并后的最终判定集合。
- 连字符表示范围，例如“白-黄”包含白色、近白色、浅黄色、淡黄色和黄色；无连字符的“黄绿色”是独立复合色。

## 干扰项规则

- `forbidColorPairs`：禁止两个颜色同时出现在最终选项集合中，无论其中之一是否为正确答案。本版包含 `["白色", "无色"]`。该规则在所有加权和排序完成后再次执行，并自动从后续候选补足被移除的选项。
- `preferSame`：优先匹配的语义字段，`focusElement` 表示化学式中的中心或主元素。
- `focusElementProbability`：启用同元素优先抽样的概率，当前为 `0.8`。
- `focusElementMaxChoices`：一道题中同元素干扰项的最大数量，当前为 `2`。
- `forbidAcceptanceRelationsBetweenAnyChoices`：仅用于“物质→颜色”题，对最终颜色选项两两检查；任一方向存在标准术语连接时拒绝共现。

## 扩展示例

后续可以只增加格式定义及相应生成器，而不修改物质库：

```json
{
  "id": "true_false_color",
  "questionType": "single_choice",
  "generator": "substance_color_assertion",
  "prompt": [
    { "token": "substance_with_qualifier" },
    { "text": "呈" },
    { "token": "asserted_color" },
    { "text": "。判断正误。" }
  ]
}
```

格式文件由 `question-format.schema.json` 验证。一次答题中的随机实例只存在于内存或答题日志中，不写回题目库。
