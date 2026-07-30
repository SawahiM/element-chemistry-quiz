# ChemQuizFormat 1.4

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

随机选择一条观察，以物质、状态和条件构造题干。同一物质在相同状态和条件下可以有多个可接受颜色，`acceptedColorIds` 中的任意一个均判为正确；同一物质的其他真实颜色不会被用作错误选项。“白色”和“无色”禁止互为干扰项。若数据库中存在相同 `focusElement` 的其他物质，则以 80% 概率优先抽取最多两个相关颜色，以增加同一元素化合物之间的辨析难度。

### `color_to_substances`

先选择至少对应三个物质的颜色，再从中抽取二至三个正确物质，并补足其他颜色的干扰物质。白色题排除无色物质，无色题排除白色物质；错误物质也优先从与正确物质具有相同 `focusElement` 的记录中抽取。题目每次现场生成。

### `color_to_one_substance`

随机选择一条颜色观察作为唯一正确项，并给出四种物质。其他三种物质全部不具有目标颜色；干扰项优先匹配正确物质的 `focusElement`、观察类型和物态，同时执行白色/无色最终互斥检查。

## 干扰项规则

- `forbidColorPairs`：禁止两个颜色同时出现在最终选项集合中，无论其中之一是否为正确答案。本版包含 `["白色", "无色"]`。该规则在所有加权和排序完成后再次执行，并自动从后续候选补足被移除的选项。
- `preferSame`：优先匹配的语义字段，`focusElement` 表示化学式中的中心或主元素。
- `focusElementProbability`：启用同元素优先抽样的概率，当前为 `0.8`。
- `focusElementMaxChoices`：一道题中同元素干扰项的最大数量，当前为 `2`。

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
