import { SAMPLE_SCHEMA } from './sample-schema.mjs';
import { buildCapabilities, REQUEST_BINDINGS, CATALOG_CAPABILITIES } from './sample-capabilities.mjs';

export function resolveSchema(node, schema) {
  if (!node.$ref) return node;
  const name = node.$ref.match(/^#\/\$defs\/([^/]+)$/)?.[1];
  if (!name || !Object.hasOwn(schema.$defs, name)) throw new Error(`Missing schema definition: ${node.$ref}`);
  return resolveSchema(schema.$defs[name], schema);
}

// Find where a parameter definition is reachable from document. No capability
// IDs or document kinds are duplicated in this renderer.
export function schemaRoutes(definition, schema = SAMPLE_SCHEMA) {
  const routes = [];
  function visit(node, location, kind, selectors, stack = []) {
    if (node.$ref) {
      if (stack.includes(node.$ref)) throw new Error(`Recursive document schema: ${node.$ref}`);
      const resolved = resolveSchema(node, schema);
      const nextKind = resolved.properties?.kind?.const ?? kind;
      if (node.$ref === `#/$defs/${definition}`) {
        routes.push({location, kind:nextKind, selectors});
        return;
      }
      visit(resolved, location, nextKind, selectors, [...stack,node.$ref]);
      return;
    }
    const nextKind = node.properties?.kind?.const ?? kind;
    const nextSelectors = {...selectors};
    if (node.properties?.capability?.const) nextSelectors.capability = node.properties.capability.const;
    for (const branch of node.oneOf ?? []) visit(branch, location, nextKind, nextSelectors, stack);
    for (const [name, child] of Object.entries(node.properties ?? {})) visit(child, `${location}.${name}`, nextKind, nextSelectors, stack);
    if (node.items) visit(node.items, `${location}[]`, nextKind, nextSelectors, stack);
  }
  visit(schema.$defs.document, 'document', undefined, {});
  return routes;
}

export function checkPublicDefinitions(schema = SAMPLE_SCHEMA, bindings = REQUEST_BINDINGS, catalog = buildCapabilities(), catalogCapabilities = CATALOG_CAPABILITIES) {
  const equal = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!equal(schema.$defs.sample.properties.feature.enum, Object.keys(bindings))) throw new Error('Schema feature enum and compiler bindings disagree.');
  const ids = catalog.capabilities.map(c=>c.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate capability IDs.');
  for (const [id,binding] of Object.entries(bindings)) {
    if (!schema.$defs[binding.definition]) throw new Error(`Missing schema definition: ${id}/${binding.definition}`);
    const routes = schemaRoutes(binding.definition,schema);
    if (!routes.length || routes.some(route=>!route.kind)) throw new Error(`Unreachable document schema: ${id}`);
    if (routes.some(route=>route.selectors.capability && route.selectors.capability !== id)) throw new Error(`Schema capability discriminator disagrees: ${id}`);
    const entry = catalog.capabilities.find(c=>c.id===id);
    if (!entry?.requestSupported || entry.status !== 'implemented') throw new Error(`Public binding is not implemented/requestSupported: ${id}`);
    if (entry.parametersSchema !== `schemas/sample-catalog.schema.json#/$defs/${binding.definition}`) throw new Error(`Parameter schema reference disagrees: ${id}`);
  }
  // A capability with a catalog kind of its own is public through its own schema file.
  for (const capability of catalogCapabilities) {
    if (Object.hasOwn(bindings,capability.id)) throw new Error(`Catalog capability also bound in Sample Catalog: ${capability.id}`);
    const entry = catalog.capabilities.find(c=>c.id===capability.id);
    if (!entry?.requestSupported || entry.status !== 'implemented') throw new Error(`Public catalog capability is not implemented/requestSupported: ${capability.id}`);
    if (entry.parametersSchema !== capability.parametersSchema || capability.schema?.properties?.kind?.const !== capability.id) throw new Error(`Catalog capability schema disagrees: ${capability.id}`);
  }
  for (const entry of catalog.capabilities) if (entry.requestSupported && !Object.hasOwn(bindings,entry.id) && !catalogCapabilities.some(c=>c.id===entry.id)) throw new Error(`Missing public binding: ${entry.id}`);
  // Annotation branches must also be accounted for in the reverse direction.
  const annotation = schema.$defs.annotation;
  if (annotation) for (const branch of annotation.oneOf ?? []) {
    const node = resolveSchema(branch,schema), id = node.properties?.capability?.const;
    if (!id || !bindings[id] || node.properties?.parameters?.$ref !== `#/$defs/${bindings[id].definition}`) throw new Error(`Unbound annotation schema: ${id}`);
  }
}

const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('`','&#96;').replace(/\r?\n/g,'<br>');
const code = value => `<code>${escape(value)}</code>`;

export function schemaTable(node, schema = SAMPLE_SCHEMA) {
  const rows = ['| parameter / field | 型 | 必須 / 任意 | enum / const | 値域・構造制約 | 条件 |', '|---|---|---|---|---|---|'];
  function visit(raw, location, required, condition, stack = []) {
    if (raw.$ref && stack.includes(raw.$ref)) throw new Error(`Recursive parameter schema: ${raw.$ref}`);
    const nextStack = raw.$ref ? [...stack,raw.$ref] : stack;
    const current = resolveSchema(raw,schema);
    if (current.oneOf) {
      current.oneOf.forEach((branch,index)=>{
        const resolved = resolveSchema(branch,schema);
        const constants = Object.entries(resolved.properties ?? {}).filter(([,v])=>Object.hasOwn(v,'const')).map(([key,v])=>`${key}=${JSON.stringify(v.const)}`);
        visit(branch,location,required,[condition,`oneOf ${index+1}${constants.length ? ': '+constants.join(', ') : ''}`].filter(Boolean).join('; '),nextStack);
      });
      return;
    }
    const values = current.enum ?? (Object.hasOwn(current,'const') ? [current.const] : []);
    const type = current.type ?? (values.length ? [...new Set(values.map(v=>v===null?'null':typeof v))] : '—');
    const limits = ['minimum','maximum','minLength','maxLength','minItems','maxItems','minProperties','pattern','uniqueItems','additionalProperties']
      .filter(key=>Object.hasOwn(current,key)).map(key=>`${key}=${JSON.stringify(current[key])}`);
    rows.push(`| ${code(location)} | ${escape(Array.isArray(type)?type.join(' / '):type)} | ${required?'必須':'任意（親指定時）'} | ${values.map(v=>code(JSON.stringify(v))).join(', ') || '—'} | ${limits.map(code).join('<br>') || '—'} | ${escape(condition || '—')} |`);
    for (const [name,child] of Object.entries(current.properties ?? {})) visit(child,location==='.'?name:`${location}.${name}`,(current.required ?? []).includes(name),condition,nextStack);
    if (current.items) visit(current.items,`${location}[]`,true,condition,nextStack);
  }
  visit(node,'.',true,'');
  return rows.join('\n');
}

export function renderCapabilityDocumentation(catalog = buildCapabilities(), schema = SAMPLE_SCHEMA, bindings = REQUEST_BINDINGS, catalogCapabilities = CATALOG_CAPABILITIES) {
  checkPublicDefinitions(schema,bindings,catalog,catalogCapabilities);
  const own = id => catalogCapabilities.find(c=>c.id===id);
  const lines = ['# Sample Capability詳細（自動生成）','',
    '<!-- Generated by node scripts/generate-capabilities.mjs. DO NOT EDIT. -->','',
    '直接編集禁止。コード上の能力定義・公開バインディングと正式JSON Schemaから生成します。更新: `node scripts/generate-capabilities.mjs`。','',
    `Application: ${code(catalog.applicationVersion)} / Catalog schema: ${code(catalog.sampleCatalogSchemaVersion)}`,'',
    '[概念・書き方・検証](../sample-request-spec.md) / [機械一覧](../../capabilities.json) / [正式Schema](../../schemas/sample-catalog.schema.json) / [内部パラメータの公開対応表](parameter-exposure.md)','',
    'statusは内部の実装状態、requestSupportedは外部要求APIへの公開状態です。実装済みでも未公開の能力は要求できません。必須は親オブジェクトを指定した場合の必須性です。oneOfの行は選択した分岐ごとに読み、別分岐の条件を混ぜないでください。値域の受理は実機での全域検証を意味しません。','',
    '| Capability ID | description / 名前 | status | requestSupported | document kind |', '|---|---|---|---|---|'];
  for (const entry of catalog.capabilities) {
    const routes = bindings[entry.id] ? schemaRoutes(bindings[entry.id].definition,schema) : [];
    lines.push(`| ${code(entry.id)} | ${escape(entry.description)} | ${escape(entry.status)} | ${entry.requestSupported} | ${own(entry.id) ? escape(own(entry.id).catalog) : [...new Set(routes.map(r=>r.kind))].map(code).join(', ') || '外部API未公開'} |`);
  }
  for (const entry of catalog.capabilities) {
    lines.push('',`## ${escape(entry.id)}`,'',escape(entry.description),'',`status: ${code(entry.status)} / requestSupported: ${code(entry.requestSupported)}`,'');
    const reference=entry.parametersSchema ?? entry.parametersReference;
    lines.push(`[Schema / パラメータ参照](../../${reference})`,'');
    if (bindings[entry.id]) {
      const binding=bindings[entry.id];
      for (const route of schemaRoutes(binding.definition,schema)) lines.push(`document kind: ${code(route.kind)} / 指定場所: ${code(route.location)}${route.selectors.capability ? ' / capability: '+code(route.selectors.capability) : ''}`,'');
      lines.push(schemaTable(schema.$defs[binding.definition],schema),'');
    } else if (own(entry.id)) {
      lines.push(`${escape(own(entry.id).catalog)}（Sample Catalog とは別の種別。${code('kind')}: ${code(JSON.stringify(entry.id))}）`,'');
      lines.push(schemaTable(own(entry.id).schema,own(entry.id).schema),'');
    } else {
      lines.push('外部要求のパラメータSchemaはありません。内部Recipe用の情報を外部要求へ転記しないでください。','');
      if (entry.supportedParameters) lines.push(`内部パラメータ名: ${entry.supportedParameters.map(code).join(', ')}`,'');
    }
    lines.push('制限:','',...entry.limitations.map(limit=>`- ${escape(limit)}`));
  }
  return lines.join('\n')+'\n';
}
