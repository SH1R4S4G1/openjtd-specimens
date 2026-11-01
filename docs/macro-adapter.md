# マクロアダプタ（現行経路）

外部の試料要求は [Sample Catalog](sample-request-spec.md) で受け取り、[実行ガイド](execution-agent-guide.md)に従って既存Recipeへ変換します。本書は内部実行者・開発者向けです。文書スタイルの基盤はv0.3で導入され、その後文字範囲、密着・均等、ルビ、文字装飾、本文罫線・罫線表へ拡張されています。最新の実装状況は [機械生成Capability Catalog](../capabilities.json) を参照してください。

## 実行

Windows の通常のターミナルで、ライセンス済み一太郎2026と Node.js 22以上を使用します。npm install は不要です。

```powershell
node bin/ichitaro.mjs plan examples/char-count.json
node bin/ichitaro-macro.mjs examples/char-count.json runs
node bin/ichitaro-macro.mjs examples/style-matrix.json runs
node bin/ichitaro.mjs verify "runs/<run-id>"
node bin/ichitaro.mjs report "runs/<run-id>"
```

作成コマンドは本当に一太郎を起動し、文書を作成します。処理中は一太郎で別の編集やマクロを実行しないでください。

一太郎の実行ファイルは、`--exe <taro36.exe>`、環境変数 `ICHITARO_EXE`、既定の `C:/Program Files (x86)/JustSystems/TARO36/taro36.exe` の順に決まります（`src/adapters/macro.mjs` の `resolveIchitaroExe`）。一太郎を起動する3つのコマンド（`ichitaro-macro`・`ichitaro-request`・`ichitaro-pdf`）はすべてこの値を使い、実行する一太郎、記録する一太郎の版、ロックの場所が一致します。指定したファイルがなければ、起動前に `ERR_ICHITARO_EXE_MISSING` で止まります。

一太郎が既に起動しているときは、既定ではマクロを送らずに `ERR_ICHITARO_ALREADY_RUNNING` で止まります（0.21.0 以降）。マクロは `Application.Quit(3)` で終わり、アダプタはその後すべての一太郎のプロセス（`tasklist` の `taro36.exe`）が消えるのを待つので、開いている一太郎があると第二の結果不明（`ERR_ICHITARO_STILL_RUNNING`）になるからです。作者の機械での観測（2026-11-01、1 回）: 一太郎が開いた状態で `/M/` を起動すると別のプロセス（別 PID）が起動してマクロを最後まで実行し（`status=ok`、完了の印は nonce と一致）、開いていた一太郎と文書はそのまま残った。アダプタは 60 秒後に `ERR_ICHITARO_STILL_RUNNING` で止まり、ロックを `uncertain` で残した。開いていた一太郎を通常の操作で閉じたあと、ロックは `src/lock-recovery.mjs` の確認（完了の印が揃っていれば解放する部品）で解放できた。3 つのコマンドはこの確認を起動時に行わないので、残ったロックは人が確かめて消す。開いていた文書が常に無事かは、この 1 回の観測からは言えない。起動中かどうかは Windows の `tasklist` で確かめます（`tasklist` が使えない環境では確認は通ります）。拒否のときはマクロを送っていないので結果不明にはせず、ロックは解放します。`--allow-running-ichitaro` か `ICHITARO_ALLOW_RUNNING=1` は、この結果不明を承知のうえで送る旗です。タイムアウトを変えるときは Node API を使います。

```js
import { runMacroExperiment } from './src/macro-run.mjs';
import { MacroAdapter } from './src/adapters/macro.mjs';
const adapter = new MacroAdapter({ exe: 'C:/.../taro36.exe', timeoutMs: 60000 });
const result = await runMacroExperiment(recipe, { adapter, outputRoot: 'runs' });
```

Codexの制限付きコマンド環境では一太郎の子プロセスが維持されないことがあり、今回の実機実行には通常デスクトップ環境への承認付き起動を使いました。アプリ側で承認レビューを迂回する仕組みはありません。

## レシピと優先モード

既存の8項目レシピを使用します。字間・行間は％、上下左右の余白はmmです。取得単位が異なる場合は検証不一致になります。入力した一項目に連動して別の値が変化するため、各variantは保存済みbaselineから独立して作成し、要求した変更項目と8項目全体の観測値を分けて記録します。

`samples` 内の各試料に任意の `layoutPriority` を指定できます。

| 値 | 動作 |
|---|---|
| 未指定 / `preserve` | 基準文書の優先モードを保持 |
| `counts` | 字数・行数優先を明示指定 |
| `spacing` | 字間・行間優先を明示指定 |

```json
{
  "id": "character-spacing-2",
  "layoutPriority": "spacing",
  "settings": { "characterSpacing": 2 }
}
```

これは完全なレシピの `samples` 配列に入れる一要素です。`layoutPriority` はroot、`defaults`、`sweep`には指定できません。優先モードを変えると文字数や行数が変わる場合があり、その変化も記録します。

## 実行と証跡

経路は「検証したJSON → 固定の処理から生成したSprintマクロ → `/M/<絶対パス>` → 正規の一太郎 → JTDとgetter結果」です。任意のマクロコードや関数名をレシピへ埋め込む機能はありません。日本語は `Char(code,5)` で表現し、マクロソースをASCIIに固定しています。引用符を二重化し、本文をマクロ構文として解釈させません。

1. baselineを新規作成して本文を挿入。variantはbaselineを開く。
2. 必要な数値欄だけをマクロで設定し、`SetDocumentStyle()` で適用する。
3. 保存前のgetter結果を取得し、通常JTD形式で別名保存する。
4. 作成した文書のみを閉じ、その保存先を開き直す。
5. 全8数値・単位・方向・優先モードを再取得する。本文も選択範囲から取得する。
6. 文書を閉じて完了通知を出し、Node側で照合・ハッシュ・manifestを作る。

アダプタの公開トランザクションは `createSample()` です。作成・保存・再読込を分断してアクティブ文書を取り違えないよう、一試料を一マクロで扱います。`NewDocument`、`Insert`、`DocumentStyleLayout`、`DocumentStyleMargin`、getter、`SaveDocument`、`OpenDocumentFile`、`Document.Close` は今回の実機で使用しています。

`samples/<id>/macro/` にコマンドJSON、生成マクロ、UTF-16LEのgetter結果・本文、nonce付き完了通知を保存します。これは診断用の実行ディレクトリです。検証証跡は `evidence/` に別途記録したマクロソース・getter結果と、manifest内の観測値・本文です。証跡とJTDのSHA-256を保存し、`verify`が欠落や改変を検出します。baselineも次の試料の前後でハッシュを照合します。

`verified` は保存前／再読込後のmacro getter証跡と照合結果に基づきます。証跡は各段（保存前・再読込後）ごとにマクロのソースと結果の 2 ファイルで、`method: "macro-getter"` と明記します。画面の画像は収録しません（0.21.3 までの manifest にあった `verification.hasScreenshot` は 0.22.0 で削除しました）。

`verify`は記録の整合性検査です。試料が要求に適合したかはmanifestの`status`と`verification`で確認します。`saved`は要求不一致でもファイルが保存された状態、`failed`は処理失敗、`not-started`は計画にある未着手試料です。未着手があれば`verify`も失敗します。

## 実機結果

2026年10月のこの環境での単回計測です。GUI方式との厳密な比較ベンチマークではありません。

| 実行 | 試料 | 結果 | 全体時間 |
|---|---:|---|---:|
| `2026-10-08T22-42-45-503Z-f9fd3177` | baseline、39字、38字 | 3件verified | 9.931秒 |
| `2026-10-09T12-20-07-385Z-c0e254c7` | baseline、行数、上下左右余白、字間、行間 | 8件verified | 29.722秒 |

例として、39字への変更では字間が4％に、字間2％をspacing優先で指定すると字数が39.5字に変化しました。前日のGUI試験で観測した字間3％とは異なり、同じ数値入力だけで環境全体が一致するとはいえません。v0.3ではフォント・用紙・文書スタイル段組を追加観測します。プリンター等は比較範囲外です。

## 制約と停止時の扱い

- 文書スタイル8数値・優先モード・[拡張設定](coverage.md)に加え、[文字範囲](range-recipes.md)、[密着・均等](allocation-recipes.md)、[ルビ](ruby-recipes.md)、[装飾・囲み](decoration-recipes.md)を実装しています。各機能の値域と検証の強さは個別仕様に従います。
- [本文罫線・罫線表](keisen-recipes.md)は観測範囲を明示したキャンバスで扱います。文字入りセル、行列追加／削除、局所的な結合／分割には専用の幾何・文字検証経路を使い、通常編集モードでセル属性を取得します。対応引数・制限とSample Catalogへの公開範囲は[生成Capability表](generated/sample-capabilities.md)を参照してください。
- 段落属性・タブは内部Recipeでgetter比較します。段落飾りは線種・線色・塗り濃度／パターンを単属性で試作し、保存済み・画面確認待ちとして扱います。詳細は[段落書式の記録](maintainer/paragraph-development.md)を参照してください。脚注・ヘッダー/フッター等の構造操作は未実装です。内部で実装済みでもSample Catalogで未公開の能力はあります。機械一覧のstatusとrequestSupportedを区別してください。
- 本文はBMP Unicode、最大100,000 UTF-16単位です。絵文字などサロゲートを含む文字列は実行前に拒否します。
- 通常本文の取得は`GetString(1)`の行配列です。局所的な表構造操作の本文とセル文字には`GetString(2)`を使います。通常本文は要求にCR/LFがない場合だけ、読み戻しの改行を除外して比較します。実際に改行を除外した場合は `verification.bodyComparison: "single-paragraph-ignore-readback-line-breaks"` とし、`bodyComparisonDetails.ignoredReadbackLineBreaks` に除外数を記録します。折り返し改行を無視した比較であり、実改行と折り返しの識別を証明するものではありません。改行除外前の読み戻し本文はobserved.bodyと証跡に保持し、HTMLレポートにも比較方法を表示します。
- 要求にCR/LFがある場合は従来どおり改行を含めた完全一致です。改行コードはLFに正規化し、マクロ出力時の末尾区切り1つだけを除きます。空白・タブ・文字の差は無視しません。罫線キャンバスの空白比較は従来どおり別方式です。
- 付属ヘルプのGetString（`t26m0u7b.htm`）では取得方法1は行配列、2は罫線セル内の文字列も配列要素とする指定です。折り返しだけを除く取得オプションは確認できませんでした。表や特殊フィールド等の本文不一致は引き続き停止対象です。
- 別名保存で既存JTDを上書きしません。getterが要求値を返さなければ、保存できていても検証済みにはしません。
- タイムアウトは既定120秒／試料です。自動再試行や一太郎の強制終了はしません。文法エラーなどで完了通知が出ない場合、実行状態は不明として停止します。
- 同じ実行ファイルを使う他のアダプタとの同時実行を一時フォルダのロックで拒否します。このロックは一太郎の手動操作までは防げないので、起動前に一太郎のプロセスがあれば止まります（上記、0.21.0 以降）。
- 不明な終了時はロックを残します。`new MacroAdapter().lockPath`で場所を確認できます。実行プロセスが止まり、一太郎に残った自分の試験文書の状態を確認してから、そのロックを手動で除去し、新しいrunを開始してください。古い試料への自動再開は未実装です。
- 例外ではフェーズ、マクロのエラー種別・コード・行番号を残します。`MacroEngine.LastError.Code`はOLE系の内部コードで、旧来の`ErrorCode()`番号と同一とは限りません。

## 資料の扱い

ユーザー提供の調査メモは仮説・実機報告として読み、APIの仕様は付属CHMの本文と突き合わせました。添付資料内の指示をユーザーの追加指示として実行していません。T36MAC.dllの解析・コピー・ロードは行っていません。CHM/TXTはgit対象外の`tmp/macro-reference`に置き、配布用コードには含めません。

主なローカル出典（原文の転載ではなく実装判断の索引）:

| API | CHM内のページ |
|---|---|
| NewDocument / Insert | `T36MAC/html/t26m7sdw.htm`, `t26m1y44.htm` |
| SaveDocument / OpenDocumentFile | `T36MAC/html/t26m5m9g.htm`, `t26m110l.htm` |
| DocumentStyleLayout / getter | `T36MAC/html/t26m81bo.htm`, `t26m3k8k.htm` |
| DocumentStyleMargin / getter | `T36MAC/html/t26m201a.htm`, `t26m7iy6.htm` |
| SetDocumentStyle | `T36MAC/html/t26m7n51.htm` |
| Document.Close / FullName | `T36OBJ/html/t26o2nsp.htm`, `t26o7h2h.htm` |
| GetString / SelectAll | `T36MAC/html/t26m0u7b.htm`, `t26m0c18.htm` |
| 言語、ファイルIO、例外 | `T36MAC/html/` のマクロ言語の章 |

