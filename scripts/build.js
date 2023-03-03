const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const fs = require("fs/promises");
const got = require("got").default;

const VSCODE_RAW = "https://raw.githubusercontent.com/microsoft/vscode";
const VSCODE_COMMIT = "8a38481180ae939c53ceae3aab12a743b2a36493";
const MONACO_RAW = "https://raw.githubusercontent.com/microsoft/monaco-editor";
const MONACO_COMMIT = "920affc75f7f5d505eaaa5299d4323e4a90d5be1";

// https://github.com/microsoft/vscode/blob/HEAD/extensions/theme-seti/icons/vs-seti-icon-theme.json#L1885

/**
 *
 * @param {string} path
 * @returns {string}
 */
function getPrefixName(path) {
  const list = path.split("/");
  return list[list.length - 1];
}

/**
 *
 * @param {string} path
 * @returns {string}
 */
function getRegisterFileLink(path) {
  return `${MONACO_RAW}/${MONACO_COMMIT}/${path}/${getPrefixName(path)}.contribution.ts`;
}

async function main() {
  try {
    fs.mkdir("./build");
  } catch (error) {}

  const { data } = await got
    .post("https://sourcegraph.com/.api/graphql", {
      json: {
        query: `
query (
  $repository: String!
  $ref: String!
  $path: String!
  $recursive: Boolean = false
) {
  repository(name: $repository) {
    commit(rev: $ref) {
      tree(path: $path) {
        entries(
          first: 50000
          recursive: $recursive
          recursiveSingleChild: false
        ) {
          path
          isDirectory
        }
      }
    }
  }
}
`,
        variables: {
          path: "src/basic-languages",
          recursive: false,
          ref: MONACO_COMMIT,
          repository: "github.com/microsoft/monaco-editor",
        },
      },
    })
    .json();

  const fileIdLookMap = {};
  for (const it of data.repository.commit.tree.entries) {
    if (it.isDirectory && getPrefixName(it.path) !== "test") {
      // https://raw.githubusercontent.com/microsoft/monaco-editor/920affc75f7f5d505eaaa5299d4323e4a90d5be1
      // /src/basic-languages/cpp/cpp.contribution.ts

      const code = await got.get(getRegisterFileLink(it.path)).text();
      const ast = parser.parse(code, {
        // parse in strict mode and allow module declarations
        sourceType: "module",
        plugins: ["typescript"],
      });

      traverse(ast, {
        CallExpression(exp) {
          if (exp.node.callee.name !== "registerLanguage") {
            return;
          }

          const param = exp.node.arguments[0];
          let id = "";
          let extensions = [];
          if (t.isObjectExpression(param)) {
            param.properties.forEach((prop) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                switch (prop.key.name) {
                  case "id": {
                    id = prop.value.value;
                    break;
                  }
                  case "extensions": {
                    if (t.isArrayExpression(prop.value)) {
                      extensions = prop.value.elements.map((e) => e.value);
                    }
                    break;
                  }
                }
              }
            });
          }
          if (id === "" || extensions.length === 0) {
            return;
          }

          extensions.forEach((ext) => {
            fileIdLookMap[ext] = id;
          });
        },
      });
    }
  }

  const loopupMap = JSON.stringify(fileIdLookMap, null, 2);

  await fs.writeFile("./build/fileIdLookMap.json", loopupMap);

  const iconDefine = await got
    .get(`${VSCODE_RAW}/${VSCODE_COMMIT}/extensions/theme-seti/icons/vs-seti-icon-theme.json`)
    .json();

  const output = {
    exts: fileIdLookMap,
    languageIds: iconDefine.languageIds,
    fileNames: iconDefine.fileNames,
    iconDefinitions: iconDefine.iconDefinitions,
    exts: fileIdLookMap,
    font: `${VSCODE_RAW}/${VSCODE_COMMIT}/extensions/theme-seti/icons/seti.woff`,
  };

  await fs.writeFile(
    "./build/index.js",
    `
var fileIconInfo = ${JSON.stringify(output, null, 2)};
module.exports = fileIconInfo;
`
  );
}

main();
