# 複数脚注・位置指定・変更・削除

2026-10-14時点では、位置指定した複数脚注の作成、内容変更、削除、全削除、再設定を内部Recipeで扱い、最終状態の脚注集合をSample Catalogへ公開しています。以下の初期実装・調査記録の「未対応」「未接続」は当時の状態です。

## 外部要求API

[公開例](../examples/agent/12-footnotes.json) のように feature は document-footnote、document.kind は footnotes とします。document.text が本文、document.notes が最終的に含める脚注の集合です。各脚注は安定したid、paragraph、offset、textを持ちます。

paragraphは0から数える本文段落番号、offsetはその段落内の元の本文に対する0から数える文字位置です。脚注番号の挿入によってoffsetを書き換える必要はありません。段落先頭・途中・末尾を指定できます。空集合は脚注なしの対照文書です。同じ位置に複数の脚注は置けません。正確な型・値域は [正式Schema](../schemas/sample-catalog.schema.json) と [公開能力表](generated/sample-capabilities.md) を参照してください。

外部要求は他のSample Catalogと同じく最終状態を表します。配列順は位置順へ正規化され、内容違い・削除後の集合も独立baselineから生成します。過去試料に実際に変更・削除を加えた経路を観測したい場合は、次節の内部履歴を使用します。外部の最終状態作成を削除履歴の証明とは扱いません。

```sh
node bin/ichitaro.mjs validate examples/agent/12-footnotes.json
node bin/ichitaro.mjs compile examples/agent/12-footnotes.json tmp/my-footnote-request
node bin/ichitaro-macro.mjs tmp/my-footnote-request/notes-three.recipe.json
```

## 内部の操作履歴

[履歴レシピ](../examples/footnote-lifecycle.json) の footnote.steps へ add / modify / remove を順番に記録します。addはid・paragraph・offset・text、modifyは既存id・text、removeは既存idのみを指定します。削除したIDは再利用せず、再設定には新しいIDを付けます。各variantは独立したbaselineからその履歴全体を実行します。

番号を含む全文、各脚注の対応番号と往復ジャンプ、個別脚注本文、脚注エリア全体の順序と内容を操作ごと・保存前・再読込後に検査します。modifyでは全対象文字を読み戻して一致した場合だけ置換します。removeは本文の脚注番号を削除し、残りの本文・脚注と空状態を検証します。全削除後、脚注領域へ入れる場合は残留文字がないことを確認し、入れない場合は本文に留まる事実を記録します。

再採番には注意が必要です。削除や逆順挿入直後は、内部番号・本文の数字表示・脚注エリアの表示接頭辞が異なる時点で更新されます。保存前は番号と表示を別に記録し、位置・全文・対応ジャンプを照合します。再読込後は本文の内部番号と表示が本文順の番号と一致することも検査します。脚注エリアの接頭辞は作成時の値を保持する場合があるため、所属の証明には使いません。

旧 footnote.text の単独Recipeは互換性を維持しproof version 1、新しい履歴はversion 2で区別します。台帳・観測・次のRecipeへ要求と一致するproofを渡します。

## 実機確認と制限

通常履歴7試料、外部要求からの8試料、公開上限の8脚注・内容24文字を含む境界2試料、合計17試料がverifiedとなりました。証跡とハッシュも全件確認しています。詳細なrun・各操作のproofは tmp/footnotes-completion-evidence-20261014.json、台帳は catalogs/footnotes-20261014、差分観測と次のRecipeは observations/footnotes-lifecycle-20261014 です。全201テスト成功。失敗した先行runを検証済みへ変更していません。

現在は固定基準の短い横書きBMP本文です。用紙・フォント・余白の上書きや他構造との複合条件、複数ページへの配置、折返しを伴う脚注、継承書式や物理寸法は対象外です。空白や改行を含む脚注本文、同位置への重複挿入は受け付けません。今回の確認はgetterと実ファイルの保存・再読込によるもので、画面証跡は追加していません。

---

## 初期の単独脚注実装（履歴）

[実行例](../examples/footnote-single.json) は、第2段落先頭に番号付き脚注を1個挿入する内部Execution Recipeです。`footnote.text` に短い脚注本文を指定します。`null` は脚注を作成しない対照試料です。各variantは独立したbaselineから作成し、前のvariantの脚注を変更する動作ではありません。

```sh
node bin/ichitaro-macro.mjs examples/footnote-single.json
```

基準は横書き、A4単票縦、游明朝（標準）10.5pt、40字×40行、字間1%・行間60%、四辺30mmです。本文は空白・制御文字を含まない短いBMP文字の3段落、脚注本文も同様に24文字までとします。番号形式は `%1`、サイズモードは1です。Footnote、JumpFootnote、GetFootnoteNumber、GetFootnoteArea、GetCursorArea、GetCharacter、GetStringの公開APIを利用します。

検証内容は以下です。

- 挿入前、保存前、再読込後に全3段落の各文字を取得。脚注追加後は第2段落先頭の番号文字も確認。
- 本文の対応位置で番号1、本文領域1を確認し、対応脚注へジャンプ。脚注領域3で内容を取得。
- 内容入力前に一太郎が生成した接頭辞を取得し、「接頭辞＋指定内容」と一致することを確認。
- 脚注から本文へ対応ジャンプし、領域1・番号1・番号文字1を再確認。
- 全本文の保存後読み戻しも番号文字を含む期待本文と厳密比較。

GetFootnoteAreaは脚注領域が開いているかを表します。カーソルが脚注内にいることの証明にはGetCursorAreaを使用します。脚注から戻る前に脚注領域の先頭へ移動します。先行試験では、末尾からの対応ジャンプだけでは本文へ戻れない場合がありました。

`footnoteProof` は要求内容と対応付けてmanifest・観測レポートへ保持します。番号、本文、内容、領域などが不一致、getterが不足、要求とproofが不一致なら検証済みにしません。次の検証用Recipeにも `footnote` を引き継ぎます。

現在の対応は作成と独立した内容違いの試料です。複数脚注、任意位置、変更・削除・再設定、複数ページ、枠や文字属性との複合条件は未対応です。脚注の物理的配置、フォント・段落スタイルの継承、装飾属性全体は検証していません。画面証跡は今回追加していません。外部Sample Catalogにはまだ公開せず、内部Recipeだけで扱います。

実機証跡（2026-10-13）：`runs/2026-10-13T12-28-38-041Z-68366aca` のbaseline＋内容違い2試料がverified。verifyRunで全3試料の証跡・ハッシュ整合も確認しました。観測結果は `observations/footnote-single-20261013`、脚注単独の台帳は `catalogs/footnote-single-20261013-final` です。

先行run `2026-10-13T12-27-01-895Z-dc2e11b3` は接頭辞を固定した検証が実機と合わず停止しました。接頭辞取得へ修正後、新規runで再検証しています。先行証跡を成功へ書き換えていません。

## 複数脚注・編集・削除の実装中調査（2026-10-13）

目標は複数脚注、任意位置、変更・削除、外部API公開までであり、まだ未完了。`src/footnote-sequence.mjs` に元の本文段落・文字offsetと安定IDによる履歴計画を追加した。追加順と本文順を区別し、番号と現在のカーソル位置を再計算する。現在はまだ実行経路へ接続していない。

実機probe `tmp/probe-footnotes-multiple-v5.mjs`、結果 `tmp/footnote-probe-1791895442107` については、実際のパスを `tmp/footnotes-multiple-v5-log.txt` の先頭で確認すること。probeは3脚注（途中・段落末・次段落先頭）、2番目の内容変更、本文側の番号削除を行い、created/modified/deleted.jtd各保存の直後に再読込して全本文と全脚注の文字列を取得する。通常runのverifiedとしては登録していない。

実装に反映すべき結果：

- 作成後はAPIが指定したカーソル位置で直接Insertする。EndOfLineは行の空白を埋めてしまうため使用しない。
- JumpFootnote(1,1)は脚注番号直後の空白へ着く。CursorLeft(1)で番号に戻してJumpFootnote(2,1)を呼ぶと3脚注とも本文の対応番号へ戻った。行頭やジャンプ直後からそのまま戻ると脚注領域に留まる場合があった。
- 編集後の領域切替にはJumpFootnote(2,0)を使い、本文位置を改めて指定できる。
- 2番目の本文番号上でDelete(1)を呼ぶと、脚注本文も消える。残った3番目の本文番号は2へ振り直されるが、脚注エリアの表示接頭辞は3のまま保持された。両者の表示番号一致を検証条件にしてはいけない。
- 内容変更のprobeは対象内容先頭を取得してDelete(4)後にInsertする。製品実装では先頭1文字一致だけに依存せず、所属・全対象文字・境界を確認してから編集する必要がある。

未完了事項：上記計画と実行・厳密検証の接続、削除後の全所属検証、逆順挿入と隣接位置・全削除・再設定の実機試験、Schema・公開バインディング・コンパイラ・生成一覧・利用例・外部要求経由での実機確認。

