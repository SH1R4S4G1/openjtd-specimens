# AIエージェントの実行経路と既存Recipe

## 現行の標準経路: MacroAdapter / CLI

OpenJTD側AIの入口は [試料要求仕様](sample-request-spec.md)、Windows側AIの入口は [実行ガイド](execution-agent-guide.md) です。Catalogをvalidate/compileした後、既存Execution Recipeを `node bin/ichitaro-macro.mjs <recipe.json> runs` に渡すと、一太郎による生成・保存・再読込検証まで自動実行します。画面操作は使いません。詳細は [macro-adapter.md](macro-adapter.md) を参照してください。

このツールは、正規の一太郎を通じた試料作成と、要求値・観測値・JTD の対応付けを支援します。Node.js 22 以上で動作し、外部 npm パッケージは必要ありません。

`ichitaro.mjs` のplan/verify/reportは計画・整合性検査用で、生成は `ichitaro-macro.mjs` が担当します。画面操作で試料を作っていた旧経路（Workbench）は 0.21.0 で削除しました（[開発者ガイド](developer-guide.md)）。

## 既存Execution Recipeの計画を確認する

プロジェクトディレクトリから実行します。

```powershell
node bin/ichitaro.mjs plan examples/char-count.json
```

標準出力は JSON です。`plan.samples` に `baseline`、`chars-39`、`chars-38` の完全な要求設定が展開されます。エラーは標準エラー出力に JSON で出力し、終了コードを 1 にします。

例の `defaults` は、観測した画面の文字数 40、行数 40、字間 1、行間 60、上下左右の余白 30 を明示しています。一太郎の環境全体を固定する設定ではありません。用紙、フォント、単位、文書スタイルなど、レシピにない条件も操作時の証跡で確認してください。

一太郎では文字数・行数・字間・行間・余白が連動する場合があります。`changedFields` はレシピに書いた要求値の差分です。他の設定が実際に固定されたという検証結果ではありません。変更後の画面を読み戻し、要求値と観測値を別に記録します。

各試料は同じ `defaults` から独立して展開されます。文字数などの設定順序で結果が変わる場合にも、実行時の観測と記録が必要です。文字数は小数を受け付け、行数は整数です。計画側の数値範囲は広く設定しており、対象の一太郎が表示する実際の範囲・単位でさらに確認します。

通常の上限は基準試料を含めて 200 試料です。必要な場合は `--max-samples 1000` まで明示的に増やせます。

```powershell
node bin/ichitaro.mjs plan examples/char-count.json --max-samples 300
```

## レシピの形式

`schemaVersion` は `1`、`name` と試料の `id` は 1～80 文字の ASCII 英数字・ハイフン・アンダースコアです。先頭は英数字にします。Windows の予約名や大文字小文字だけが違う試料 ID は使えません。`text` の改行は CRLF に統一します。

`defaults` は次の 8 項目をすべて指定します。

| キー | 意味 |
| --- | --- |
| `chars` | 文字数 |
| `lines` | 行数 |
| `characterSpacing` | 字間 |
| `lineSpacing` | 行間 |
| `marginTop` | 上余白 |
| `marginBottom` | 下余白 |
| `marginLeft` | 左余白 |
| `marginRight` | 右余白 |

`sweep` は 1 項目を複数の値に変える指定です。`includeBaseline` の省略時は `true` です。名前を自分で付けたり複数項目を変更したりする場合は、`sweep` の代わりに `samples` を使います。

```json
{
  "samples": [
    { "id": "chars-half", "settings": { "chars": 39.5 } },
    { "id": "left-margin", "settings": { "marginLeft": 31 } }
  ]
}
```

この断片は完全なレシピの `sweep` と置き換えます。`samples` には基準試料が自動追加され、`baseline` は予約 ID です。`samples` と `sweep` の両方を指定することはできません。どちらも省略すると基準試料だけを作る計画になります。

## 記録の確認

試料記録で作成された run ディレクトリを指定します。

```powershell
node bin/ichitaro.mjs verify "runs/<run-id>"
node bin/ichitaro.mjs report "runs/<run-id>"
```

`verify` は記録に含まれる成果物のハッシュとサイズを確認します。一太郎の設定が要求どおりであることや、JTD の内部構造が正しいことをそれだけで証明するものではありません。失敗時は標準エラー出力に検査結果を出し、終了コードを 1 にします。

`report` は HTML レポートのパスを JSON で返します。JTD、要求設定と観測設定を照合するために開けます。旧経路が保存した画面証跡（PNG・JPEG）のハッシュも `verify` で検査できます。

```powershell
npm test
npm run check
```

テストには実機操作は含まれません。レシピの展開、入力検証、証跡記録など、一太郎を起動しない部分を確認します。
