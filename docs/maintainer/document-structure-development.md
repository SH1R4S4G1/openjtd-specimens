# 文書構造の開発・検証記録

## 方針

文書全体の単純段組、枠・脚注・ヘッダー／フッターの単独要素、文字・段落スタイル、検証済み機能同士の組合せの順に進める。公開APIで確認できない位置・所属・内容を確認済みとしない。[段落飾りの未対応条件](paragraph-development.md)は保留する。

## 基準設定とユーザー提供画面

2026-10-12に提供された6枚の文書スタイル画面を参考にした。游明朝・標準、10.5pt、縦横100%、欧文は和文フォント、数字は欧文、A4単票縦方向、横書きを固定してgetterと照合する。8数値はRecipeの40字・40行・字間1%・行間60%・余白各30mm。字数行数優先も明示する。

ページ番号の中央下・18mm、上端ヘッダー20mm、禁則や欧文体裁、行番号なし、ページ飾りなし等は画面からの参考情報。今回これらを設定・読み戻ししたとは扱わない。段間・段間罫線などの文書スタイルは既存getterで保存前後を記録するが、全設定を画像と同一にしたとは主張しない。

## 単純な本文段組

[document-columns.mjs](../../src/document-columns.mjs)と内部Recipeのsample.documentColumnsで段数の履歴を表す。[基本例](../../examples/document-columns.json)の[5試料](../../runs/2026-10-12T10-53-23-222Z-2cce3d49/index.html)と[番号付き長文](../../examples/document-columns-flow.json)の[4試料](../../runs/2026-10-12T10-54-29-128Z-fa86b5b8/index.html)が保存・再読込検証に成功した。

DocumentStyleColumns（t26m6xdf）/GetDocumentStyleColumns（t26m0jub）は段間や字数の文書スタイル設定。実際に本文へ段組を作るColumns（t26m9otv）と区別する。GetColumns（t26m3d2r）はカーソル位置の段数、CancelColumns（t26m48hf）は既存段組の解除。

初回プローブでColumns(2)の後にColumns(3)を重ねると、解除しても2段が残った。単純段組の変更では先に旧段組を解除し、各文字で1段への復帰を検査してから次の段数を適用する。未設定・設定・変更・解除・再設定の最終状態を別ファイルに保存する。

各段落の各文字をGetCharacterで比較し、同じ位置のGetColumnsを確認する。段落単位のGetStringでも文字順序を比較する。GetStringの空の構造行や折り返し行は、独立した文字検査が成功した場合だけ連結して比較する。空白を自由に削除して一致させる処理ではない。

対象は文書全体、横書き1/2/3段、限定したBMP本文。入れ子・部分範囲・縦書き・空白やタブを含む本文・他の範囲操作との複合は未対応。ページ内の座標、段の物理寸法、ページ割付、継承した文字書式は未検証。[長文2段の画面](../../observations/document-columns-visual-20261012/flow-two/reopened.png)では右段への続きが見える。[画面と元JTDのハッシュ](../../observations/document-columns-visual-20261012/flow-two/review.json)を保存し、表示時に元JTDを変更していないことを確認した。

[台帳](../../catalogs/document-columns-20261012/index.html)に文書全体の単純段組を追加した。[差分観測](../../observations/document-columns-20261012/index.html)の候補は形式の解読結果ではない。次の反復Recipeは段数履歴を保持する。

## 次の単独構造要素

ヘッダー／フッターを最初の候補として調査する。JumpHeaderFooter（t26m49f6）は上端・下端・左端・右端・本文を区別し、ページ番号を指定できる。GetHeaderFooterArrangement（t26m3dys）は共通設定を返し、SetHeaderFooter（t26m3sc2）は設定を反映する。これらだけで内容・所属を証明できたとはしない。本文とヘッダーを別々に読み、対象ページと位置を保存後にも確認できるかが次の課題。

Footnote（t26m8uw5）は脚注文字を挿入し、本文側と脚注エリア側のスタイルに依存する。脚注番号のgetterだけで本文との対応や脚注内容が確認できるとはしない。枠、脚注、左右のヘッダー／フッター操作、文字・段落スタイル、構造の複合はまだ未実装。

### ヘッダー所属の検証候補

GetCursorArea（t26m5rxd）は本文1、上端4、下端5、左端6、右端7を返す。GetPosition（t26m9j1q）はページ番号を含む連想配列を返す。GetHeaderFooterEach（t26m6pt4）の公開返り値には「付ける」が記載されていないが、T36実機では0/1を取得できた。キーがない場合は検証失敗とし、空文字だけから解除を推定しない。

### 上端ヘッダーの実装

[内部Recipe](../../examples/document-header.json)のheaderStepsは、上端・左寄せの文字列履歴。空文字で解除する。[実装](../../src/headers.mjs)はHeaderFooterEachとSetHeaderFooterで反映し、各段階・保存前・再読込後で文字列、設定の有無、20mm、領域4・ページ1、本文の領域1と全文、残り3位置の設定と共通設定の保持を検査する。初期状態は上端を無効・空、振り分けと奇偶別を無効に正規化する。ユーザー既定状態そのままの基準試料ではない。

非表示のヘッダーへJumpHeaderFooterすると確認が出て停止する。ViewImageMarginArea（t26m9dep）とViewPrintImageMarginArea（t26m7tsx）で表示してから移動すると対話なしで完了した。これらは表示用で、データ操作の網羅率とは別分類にする。

[正式な5試料](../../runs/2026-10-12T11-30-53-475Z-7e8fb149/index.html)は約18秒で未設定・設定・変更・解除・再設定の保存と再読込検証に成功した。[台帳](../../catalogs/document-header-20261012-final/index.html)と[バイナリ差分観測](../../observations/document-header-20261012-v3/index.html)へ専用headerProofを連携し、次の反復Recipeにも操作履歴を保持する。差分は形式の同定結果ではない。

[再読込画面](../../observations/document-header-visual-20261012/header-set/reopened.png)では見出し甲が本文の上に表示されている。画面確認は設定例1件のみ。表示後も元JTDのハッシュが変わらないことを確認した。座標は記録するが物理寸法・フォント継承の検証とはしない。本文は短い3段落、40字40行、字間1%、行間60%、30mm余白、游明朝標準10.5pt、A4横書きに限定する。複数ページ、奇偶別、フィールド、中央・右寄せ、他構造との複合は未対応。外部要求APIには未公開。

開発中のrun 2026-10-12T11-27-39-335Z-8b5854feは履歴の受け渡し漏れでheaderProofがなく、ヘッダー証跡に使用しない。2026-10-12T11-29-53-162Z-20c278c0はbaseline保存後のレポートエラーで中断した。これらを正式な5試料に含めない。実行層にも専用proofと要求履歴の一致検査を追加した。

### 下端フッターへの拡張

[フッターRecipe](../../examples/document-footer.json)はheaderPosition=2を指定する。省略時は従来どおり上端1。同一Recipeでは位置を固定し、自動baselineにも継承する。対象位置の初期化・設定・変更・解除・再設定を行い、残る3位置を守る。下端のGetCursorAreaは5、上端は4で、ページ1と文字列をそれぞれ照合する。20mm・左寄せ・短い横書き本文という制限は共通。

[下端5試料](../../runs/2026-10-12T11-40-41-251Z-6d1395e5/index.html)が約18秒で保存・再読込検証に成功した。共通実装変更後の[上端5試料](../../runs/2026-10-12T11-41-16-745Z-62440e63/index.html)も成功。headerProof v2にはpositionを含め、実行層・台帳・差分観測で要求位置との一致を必須とする。旧v1は上端の過去証跡としてのみ受け入れる。要求APIは引き続き非公開。

[台帳](../../catalogs/document-footer-20261012/index.html)には証跡の位置を記録し、[差分観測](../../observations/document-footer-20261012/index.html)と次の反復Recipeにも位置を保持する。差分候補は同条件保存の変動を除いた観測であり、JTDフィールドの意味を確定した結果ではない。

[再読込画面](../../observations/document-footer-visual-20261012/footer-set/reopened.png)で下端左側の「脚部甲」を確認し、表示後の元JTDハッシュ不変を記録した。画面証跡は設定例1件で、全段階の画像検証ではない。画面に見える中央のページ番号は既定設定に由来し、今回のフッター文字列とは別要素。ページ番号の設定・内容・位置のgetter検証は未対応。

### 複数ページの所属・表示

headerPages=3を追加した。[ヘッダー例](../../examples/document-header-pages.json)と[フッター例](../../examples/document-footer-pages.json)は、本文3段落をInsertPage（t26m2asl）で1段落ずつ3ページに配置する。省略時は従来の1ページ。同一Recipeの自動baselineを含めてページ数を固定し、異なるページ数の混在を拒否する。自然な折り返しによる改ページ、奇偶別、先頭ページ別、ページ単位の異なる文言は対象外。

[ページ検証](../../src/header-pages.mjs)は各段階・保存前・再読込後に全3ページを確認する。非空のヘッダー／フッターは内容・領域・GetPositionのページ番号を照合する。GetPage（t26m4nqd）はヘッダー編集中に使用できなかったため本文でのみ使用する。Jump（t26m601c）で本文の各ページ先頭へ移動し、全文字の文字列とGetPageを比較する。JumpEnd（t26m2pr8）でも3ページを確認し、余分な末尾ページを見逃さない。解除時は設定の有無と空文字、本文を確認し、存在しないヘッダーへの移動を試みない。

[ヘッダー5試料](../../runs/2026-10-12T11-49-42-111Z-d8fa4ef7/index.html)と[フッター5試料](../../runs/2026-10-12T11-50-31-158Z-92de25fd/index.html)はいずれも約22秒で保存・再読込検証に成功した。headerProof v3にはpagesを追加し、旧v1/v2は1ページの証跡としてのみ扱う。[台帳](../../catalogs/header-pages-20261012-final/index.html)、[ヘッダー差分](../../observations/header-pages-20261012/index.html)、[フッター差分](../../observations/footer-pages-20261012/index.html)と次の反復Recipeにページ数を保持する。これらはバイト変化の観測で、形式の意味を確定するものではない。

画面証跡は[中間2ページのヘッダー](../../observations/header-pages-visual-20261012/header-set-page-2/reopened.png)と[最終3ページのフッター](../../observations/header-pages-visual-20261012/footer-set-page-3/reopened.png)。表示後も元JTDはハッシュ不変。全ページの自動getter検証と、代表2画面の目視確認を区別する。全試料・全ページの画像比較、描画寸法の計測は未実装。

## 次段階：文字・段落スタイル

EntryCharacterStyle（t26m1kkl）とEntryParagraphStyle（t26m7zol）は文書に名前付き定義を登録し、同名なら変更、省略引数は設定しない。CharacterStyle（t26m9v1h）は選択範囲へ適用、SetParagraphStyle（t26m07vp）はカーソルの段落へ適用する。システムへの登録を行うRecord系は初期実装で使わない。

GetCharacterStyleList（t26m7flg）は登録名一覧であり、適用先や定義の全内容の証明にはならない。GetParagraphStyleName（t26m25np）は適用先の段落名を返す。初期試験は登録のみ→単独適用→直接指定→定義変更→保存再読込を分け、既存の文字・段落getterで実効属性と対象外への漏れを照合する。定義の存在、適用関係、実効属性、継承・優先関係を別の検証項目として扱う。枠／脚注、構造と属性の複合は未実装。

### スタイルの先行実機調査

`tmp/probe-styles-point.mjs`で文字／段落それぞれについて登録、適用、直接指定、再定義、解除を別JTDへ保存し、毎回再読込した。結果は`tmp/style-probe-1791806282451/result.txt`。12ptスタイル適用後、GetCharacterAttributeの文字サイズは10.5、GetCharacterPoint（t26m5y7o）は12を返した。GetParagraphAttributeの段落文字サイズは空。従来の文字属性getterだけをスタイルの実効値として比較してはいけない。

直接指定で14ptにすると両サイズgetterが14になり、スタイルを16ptへ再定義しても14が保持された。スタイル解除後も直接指定14が残った。段落スタイル名は適用後から解除前まで登録名を保持し、解除後に空となった。未対象段落の先頭は10.5を保持した。この先行プローブ自体は先頭文字だけの確認であり、通常Recipeの全範囲検査とは区別する。

### 名前付きスタイルの初期実装（2026-10-13）

[named-styles.mjs](../../src/named-styles.mjs)と内部sample.namedStyleを追加した。kindはcharacter／paragraph、stepsはdefine→apply→direct→redefine→clearの先頭からの履歴。中間段階で止めた試料を別JTDに保存する。[文字例](../../examples/named-style-character.json)・[段落例](../../examples/named-style-paragraph.json)はいずれも中央段落だけを対象にし、文書フォントは游明朝標準10.5ptに固定する。定義サイズ12pt、直接指定14pt、再定義16ptは初期実装の固定条件。外部要求APIには未公開。

[文字6試料](../../runs/2026-10-12T12-05-06-926Z-c4213a68/index.html)と[段落6試料](../../runs/2026-10-12T12-05-44-094Z-1787c551/index.html)が約22秒ずつで成功した。全3段落の全文字について文字同一性、GetCharacterPoint、GetCharacterAttributeの文字サイズ、GetParagraphStyleNameを各段階・保存前・再読込後に比較する。文書内登録名一覧も全体比較する。サイズ以外の文字属性への漏れはこのproofの検査対象ではない。

namedStyleProofには履歴と検証限界を保持し、実行層、[台帳](../../catalogs/named-styles-20261013/index.html)、[文字差分](../../observations/named-character-20261013/index.html)、[段落差分](../../observations/named-paragraph-20261013/index.html)が要求履歴との一致を確認する。次の反復Recipeにもkindとstepsを引き継ぐ。

登録名一覧は定義内容全体を証明しない。文字スタイルの適用名を返すgetterは未確認。直接指定14ptが残る再定義試験は「上書きが保持された」検証であり、登録定義が16ptであることの独立検証ではない。直接指定のない対象での再定義・解除・再適用、他属性、スタイル間継承、複合条件は次の拡張項目。システムへのスタイル登録は行わない。

## 次段階：単独脚注の先行試験

Footnote（t26m8uw5）、JumpFootnote（t26m7ylh）、GetFootnoteNumber（t26m8mk2）、GetFootnoteArea（t26m5rj5）を調べた。GetFootnoteAreaは脚注エリアが開いているかだけを示すため、所属はGetCursorArea=3で別に確認する。

`tmp/probe-footnote-number.mjs`は新規文書の第2段落先頭に番号形式%1の脚注を1件挿入し、対応ジャンプ先へ明示した本文を挿入する。`tmp/footnote-probe-1791841789712/result.txt`では脚注領域3、本文へ戻った領域1・番号1、再読込後の番号1・脚注領域3・同一内容を取得した。脚注先頭へJumpStartしてからJumpFootnote(2,1)で本文へ戻る必要があり、脚注末尾からの対応ジャンプでは領域3のままだった。単なる文字マーク※は番号getter=-1であり、数値番号の試料と区別する。

脚注のGetStringには番号1と2個の空白が含まれた。まだ通常Recipeへ組み込んでおらず、本文全体の保持・参照位置の厳密な検査、複数脚注、変更／解除、表示証跡は後続。これを実装済みCapabilityやverified試料には昇格させない。既定の脚注スタイルを使うため、スタイル継承も未検証。

## 2026-10-13 文書スタイル数値の要求API公開

ユーザー提示の「文書スタイル／スタイル」タブを優先し、`document.style` を公開した。名前付き文字・段落スタイルとは独立した機能。正式な入力と例は [要求仕様](../sample-request-spec.md) と [canonical example](../../examples/agent/10-document-style.json) を参照。

初回は横書き、A4単票縦、游明朝（標準）10.5ptを固定し、字数・行数優先／字間・行間優先と四辺の余白を指定する。優先側と余白は必須、従属側の指定は任意の厳密照合値とした。省略した従属値は一太郎が計算する。要求値と観測値を区別し、全8値の保存・再読込保持も確認する。字間・行間は%、余白はmm。明示した基準値と同じ値もrunnerからadapterに渡すよう修正した。既存の省略フィールドは従来どおり自動計算を許容する。

正式コンパイル出力は `tmp/public-style-v2-20261013/compilation.json`。次の各runは独立baselineを含む2試料、合計8試料がverified。`verifyRun` による証跡・ハッシュ整合も全件成功（`tmp/public-style-integrity-20261013.json`）。

| 条件 | run（runs配下） | 主な再読込値 |
|---|---|---|
| 基準 | `2026-10-12T22-16-54-074Z-c1e52bab` | 40字・40行、字間1%、行間60%、余白30mm |
| 字数行数優先 | `2026-10-12T22-17-00-073Z-1ad8ec33` | 36字・36行、字間12%、行間78% |
| 字間行間優先 | `2026-10-12T22-17-06-083Z-e4ede1f1` | 字間2%、行間70%、39.5字・37行 |
| 余白 | `2026-10-12T22-17-12-167Z-71cc71a6` | 四辺25mm、40字・40行、字間8%、行間67% |

先行試料 `2026-10-12T22-16-04-778Z-7665fb3b` は36字・36行と字間1%・行間60%を同時要求したため、実機が12%・78%へ補正しvariantはsaved・不一致として停止した。verified証跡へ昇格していない。この結果を受けて従属値を省略可能にした。先行基準run `2026-10-12T22-15-28-228Z-626d1dba` は全値明示でもverified。

本検証はgetter値と本文一致の確認であり、GUIの全設定、全値域や全組合せの保証ではない。画面証跡は今回追加していない。用紙選択、縦書き、見開き印刷、袋とじ、フォント上書き・範囲属性との複合要求は外部非公開。段落飾りの未対応事項と枠・脚注の本実装は引き続き後続対象。


## 2026-10-13 外部要求のルビ・罫線フォールバック除去

省略は一太郎APIへ委ね、明示値は引き続き照合する。ルビサイズ省略はNIL状態であり数値の解決までは検証しない。詳細は [要求仕様](../sample-request-spec.md)、[ルビ内部互換性](../ruby-recipes.md)、[罫線の検証境界](../keisen-recipes.md) を参照。

公開例 `examples/agent/11-application-defaults.json` をコンパイルして、次の6条件・独立baselineを含む12試料がverified。verifyRunのハッシュ・証跡整合も全件成功。

|条件|run（runs配下）|
|---|---|
|ruby-defaults|`2026-10-13T12-11-54-393Z-d762dfcb`|
|ruby-explicit|`2026-10-13T12-12-04-218Z-62118ba9`|
|ruby-partial|`2026-10-13T12-12-13-814Z-bb9c7562`|
|table-defaults|`2026-10-13T12-12-23-358Z-195fd3ea`|
|table-type|`2026-10-13T12-12-45-424Z-23f17589`|
|table-color|`2026-10-13T12-13-08-932Z-21653e86`|

先行run `2026-10-13T12-10-42-041Z-633fce25` は省略サイズの空getter値を数値必須として判定してsavedで停止した。空値を0へ変換せず、自動設定状態の保持として扱う修正後に新規試料で再検証した。先行証跡は変更していない。

全194テスト成功。その後のproof説明ラベル調整は該当テストを再実行し成功。生成一覧・Schema・例・リンク検査とbridgeビルドも成功。実機では現在の環境における省略と明示の組合せを確認したもので、あらゆる一太郎の現在設定・全値域を保証しない。

## 2026-10-13 単独脚注の通常機能化

先行試験を [単独脚注の内部Recipe](../footnotes.md) として統合した。第2段落冒頭の番号付き脚注1個について、作成前・保存前・再読込後の本文文字、対応番号、領域、脚注内容、往復ジャンプを検証する。脚注接頭辞は一太郎が生成した実値を挿入前に取得する。別内容のvariantは独立baselineから作成し、変更履歴とは区別する。

実機run `2026-10-13T12-28-38-041Z-68366aca` の3試料で検証済み。台帳・証跡・バイナリ差分観測と次のRecipeへの受け渡しまで統合した。全197テスト、生成物・リンク・Schema検査、bridgeビルドが成功。脚注単独の台帳と観測出力は上記手順書に記録した。

複数脚注、任意位置、変更・削除、ページ所属、スタイル・物理配置の確認、外部要求APIへの公開は後続。構造と既存属性の組合せも単独基盤の拡張後に扱う。

## 2026-10-14 複数脚注と外部公開

[脚注仕様](../footnotes.md) を複数・元の本文位置・安定IDの履歴へ拡張した。通常履歴では作成、内容変更、削除、逆順挿入、隣接位置、全削除、再設定を検証。外部APIは最終状態の脚注集合を公開し、独立baselineからコンパイルする。本文番号と表示が再読込まで異なる挙動を区別して記録する。

履歴runは runs/2026-10-13T17-19-48-679Z-1f3e8dc9。外部要求・境界試験を含む17試料の証跡整合を確認した。実機結果一覧は tmp/footnotes-completion-evidence-20261014.json。現行台帳は catalogs/footnotes-20261014、観測と次のRecipeは observations/footnotes-lifecycle-20261014。全201テスト成功。

## 2026-10-14 ヘッダー／フッターと段組の外部公開

Sample Catalogへ複数段落の文書種別 `paragraphs`（LF区切り1..8段落、各1..24文字）を追加し、`headerFooter`（`document-header`）と `columns`（`document-columns-body`）を公開した。外部は最終状態だけを指定し、コンパイラが内部のheaderSteps・headerPosition・headerPages・documentColumnsへ変換する。設定・変更・解除の履歴は引き続き内部Recipeのみ。公開例は[ヘッダー／フッター](../../examples/agent/14-header-footer.json)と[段組](../../examples/agent/15-columns.json)。

ヘッダー／フッターは3段落が必須で、`pageBreaks: true` で各段落を別ページにした3ページ文書になる。段組は3..8段落で2段または3段。現時点では1文書に1要素だけで、他の要素や文字属性との組合せは受け付けない。

外部要求からのヘッダー・フッター・3ページヘッダー（[結果](../../tmp/public-header-20261014/execution-results.json)）と2段・3段（[結果](../../tmp/public-columns-20261014/execution-results.json)）の5要求・10試料が実機でverified。headerProofの位置・ページ数、columnProofの段数が要求と一致することも確認した。

## 2026-10-14 枠（レイアウトボックス）

方針に挙げた単独構造要素の最後として、1ページ目の固定枠を実装し外部公開した。詳細・実機プローブの知見・検証限界は[枠の文書](../frames.md)にまとめた。

## 2026-10-14 ヘッダー／フッターの左・中央・右と奇数偶数ページ別

最終状態を扱う内部モジュール [header-layout.mjs](../../src/header-layout.mjs) を追加した。`HeaderFooterEach` の文字列1・2・3が左・中央・右に対応する。奇偶別は `HeaderFooterArrangement(0,1)` と位置5〜8で設定する。

実機プローブ（[v1](../../tmp/probe-header-slots-v1.mjs)〜[v3](../../tmp/probe-header-slots-v3.mjs)）の知見：

- 奇偶別が有効なとき、`GetHeaderFooterEach(1|2)` は奇数ページ用の値を返し、位置5〜8は引数エラーで読めない。
- ヘッダー領域の `GetString` は空でない位置の文字列を空白1つで区切って返す（例「左側 中央 右側」）。空の位置は区別できないため、偶数ページの文字列が中央か右かは読み戻せない。

検証は、奇数（または全）ページの左・中央・右を getter で厳密に、各ページの表示文字列の並び、奇偶設定、他の位置の無効・空、本文を保存前と再読込後に照合する。偶数ページは文字列の並びまでの検証である。

内部Recipe [header-layout.json](../../examples/header-layout.json) の6試料がverified（[run](../../runs/2026-10-14T12-09-06-632Z-5a4cd36d/index.html)）。外部要求は `headerFooter` の `center`・`right`・`evenPages`（`header-layout`）として公開し、[公開例](../../examples/agent/20-header-slots.json)の3要求・6試料がverified（[結果](../../tmp/public-header-slots-20261014/execution-results.json)）。左寄せだけの指定は従来の経路のままで、他の要素と組み合わせられる。既存の公開例14も再実行して退行がないことを確認した（[結果](../../tmp/regression-header-20261014/execution-results.json)）。

ページ番号は、本文に挿入するページ番号フィールド（`InsertPageNumberField`）として扱われるようで、ヘッダー文字列の記法では確認できていない。未対応として残す。

## 2026-10-14 名前付きスタイルの最終状態としての公開

履歴型の内部試験（定義→適用→直接指定→再定義→解除）とは別に、最終状態を扱う [style-definitions.mjs](../../src/style-definitions.mjs) を追加し、`paragraphs` 文書の `styles`（`named-styles`）として公開した。文字・段落スタイルを名前（ASCII）とサイズで1..4個定義し、段落全体へ1段落1スタイルで適用する。システムへの登録は行わない。

照合は保存前と再読込後に、文字・段落それぞれの登録名一覧（並び順を無視した集合）、全文字の実効サイズ（`GetCharacterPoint`）、文字属性のサイズ、段落スタイル名で行う。適用した段落の実効サイズがスタイルのサイズと一致することで定義内容を独立に確認する。未適用の定義は名前だけの確認である。

実機で、文書フォントを12ptにすると実効サイズは12になる一方、`GetCharacterAttribute` の文字サイズは10.5のままだった（[停止した1回目](../../tmp/public-styles-20261014/execution-results.json)）。文字属性のサイズは文書の基準サイズではないため、「スタイル定義前の値から変わらないこと」を照合する形に改めた。

[公開例](../../examples/agent/23-named-styles.json)の4要求・8試料（段落スタイル、文字スタイル、両者と未適用の定義、12pt文書）が実機でverified（[結果](../../tmp/public-styles-20261014-r2/execution-results.json)）。文字スタイルと段落スタイルの重ね掛け、スタイル間の継承、サイズ以外の属性、他の構造要素との組合せは未対応。

## 2026-10-14 段組の部分範囲

`Columns` は範囲選択ではなく「位置」に段組区間を作る。[プローブ1](../../tmp/probe-columns-range-v1.mjs)では第2〜第4段落を範囲選択して `Columns(2)` を実行したが、選択の終点（第4段落）から文末までが2段組になった。[プローブ2](../../tmp/probe-columns-range-v2.mjs)で、第2段落の先頭に `Columns(2)`、第5段落の先頭に `CancelColumns()` を置くと、第2〜第4段落だけが2段組になり、保存・再読込後も保持された。区間の境界では `GetString` に空行が入る。

段組モジュールに範囲（`columnRange`：開始・終了段落、0始まり）を追加し、`paragraphs` 文書の `columns` と併せて公開した。1文書に1範囲、段数は2または3。範囲内の全文字が指定段数、範囲外の全文字が1段であることを、各段階・保存前・再読込後に `GetColumns` で照合する。

[公開例](../../examples/agent/25-column-range.json)の3要求・6試料（中間の2段組、末尾の3段組、先頭2段落の2段組とヘッダー）が実機でverified（[結果](../../tmp/public-column-range-20261014/execution-results.json)）。既存の文書全体の段組Recipeも再実行し、退行がないことを確認した（[run](../../runs/2026-10-14T12-42-51-011Z-3dc9994f/index.html)）。複数範囲と縦書きの段組は未対応。
