/**
 * Apara espaco das pontas sem tocar em valor que nao e string.
 *
 * **Existe num arquivo proprio porque `alternatives` e um array**, e a versao
 * inline do `@Transform` obrigaria um `any` a atravessar o `map` -- o ESLint
 * type-aware recusa, e com razao: o que chega no `value` de um `@Transform` e
 * o corpo cru da requisicao, e tratar isso como tipado e como o `forbidNonWhitelisted`
 * deixa de ser a ultima linha de defesa.
 */
export function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** O mesmo, item a item, para a lista de alternativas. */
export function trimEach({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return (value as unknown[]).map((item) =>
    typeof item === 'string' ? item.trim() : item,
  );
}
