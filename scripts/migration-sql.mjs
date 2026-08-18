/**
 * Split a PostgreSQL script into top-level statements.
 *
 * Semicolons inside strings, quoted identifiers, line/block comments and
 * dollar-quoted bodies are data, not delimiters. PostgreSQL block comments may
 * nest, so the scanner tracks their depth as well.
 */
export function splitPostgresStatements(sqlText) {
  if (typeof sqlText !== "string") {
    throw new TypeError("Migration SQL must be a string.");
  }

  const statements = [];
  let statementStart = 0;
  let index = 0;
  let state = "sql";
  let blockCommentDepth = 0;
  let dollarTag = "";
  let escapeString = false;
  let statementHasCode = false;

  const escapeStringPrefixAt = (quoteIndex) => {
    const previous = sqlText[quoteIndex - 1] ?? "";
    const beforePrevious = sqlText[quoteIndex - 2] ?? "";
    const beforePrefix = sqlText[quoteIndex - 3] ?? "";
    const identifierCharacter = /[A-Za-z0-9_$]/;
    if (
      (previous === "E" || previous === "e") &&
      !identifierCharacter.test(beforePrevious)
    ) {
      return true;
    }
    return (
      previous === "&" &&
      (beforePrevious === "U" || beforePrevious === "u") &&
      !identifierCharacter.test(beforePrefix)
    );
  };

  while (index < sqlText.length) {
    const character = sqlText[index];
    const next = sqlText[index + 1];

    if (state === "line-comment") {
      if (character === "\n" || character === "\r") state = "sql";
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) state = "sql";
      } else {
        index += 1;
      }
      continue;
    }

    if (state === "single-quote") {
      if (escapeString && character === "\\") {
        index += Math.min(2, sqlText.length - index);
      } else if (character === "'" && next === "'") {
        index += 2;
      } else {
        index += 1;
        if (character === "'") state = "sql";
      }
      continue;
    }

    if (state === "double-quote") {
      if (character === '"' && next === '"') {
        index += 2;
      } else {
        index += 1;
        if (character === '"') state = "sql";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (sqlText.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = "sql";
      } else {
        index += 1;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line-comment";
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (character === "'") {
      statementHasCode = true;
      state = "single-quote";
      escapeString = escapeStringPrefixAt(index);
      index += 1;
      continue;
    }
    if (character === '"') {
      statementHasCode = true;
      state = "double-quote";
      index += 1;
      continue;
    }
    if (character === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
        sqlText.slice(index),
      );
      if (match) {
        statementHasCode = true;
        dollarTag = match[0];
        state = "dollar-quote";
        index += dollarTag.length;
        continue;
      }
    }
    if (character === ";") {
      const statement = sqlText.slice(statementStart, index).trim();
      if (statementHasCode && statement) statements.push(statement);
      statementStart = index + 1;
      statementHasCode = false;
    } else if (!/\s/.test(character)) {
      statementHasCode = true;
    }
    index += 1;
  }

  if (state !== "sql" && state !== "line-comment") {
    throw new SyntaxError(`Onvolledige PostgreSQL-migratie (${state}).`);
  }
  const finalStatement = sqlText.slice(statementStart).trim();
  if (statementHasCode && finalStatement) statements.push(finalStatement);
  return statements;
}
