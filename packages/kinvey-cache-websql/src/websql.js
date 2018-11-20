const MASTER_TABLE_NAME = 'sqlite_master';
const SIZE = 2 * 1024 * 1024; // Database size in bytes

function execute(dbName, tableName, sqlQueries, write = false) {
  const escapedTableName = `"${tableName}"`;
  const isMaster = tableName === MASTER_TABLE_NAME;

  return new Promise((resolve, reject) => {
    try {
      const db = window.openDatabase(dbName, 1, 'Kinvey WebSQL', SIZE);
      const writeTxn = write || typeof db.readTransaction !== 'function';

      db[writeTxn ? 'transaction' : 'readTransaction']((tx) => {
        new Promise((resolve) => {
          if (write && !isMaster) {
            tx.executeSql(`CREATE TABLE IF NOT EXISTS ${escapedTableName} (key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL)`, [], () => {
              resolve();
            });
          } else {
            resolve();
          }
        })
          .then(() => {
            return Promise.all(
              sqlQueries.map(([sqlQuery, parameters = []]) => {
                return new Promise((resolve) => {
                  tx.executeSql(sqlQuery.replace('#{table}', escapedTableName), parameters, (_, resultSet) => {
                    const response = {
                      rowCount: resultSet.rowsAffected,
                      result: []
                    };

                    if (resultSet.rows.length > 0) {
                      for (let i = 0, len = resultSet.rows.length; i < len; i += 1) {
                        try {
                          const { value } = resultSet.rows.item(i);
                          const doc = isMaster ? value : JSON.parse(value);
                          response.result.push(doc);
                        } catch (error) {
                          // Catch the error
                        }
                      }
                    }

                    resolve(response);
                  });
                });
              })
            );
          });
      }, reject);
      // }, (error) => {
      //   const errorMessage = typeof error === 'string' ? error : error.message;

      //   if (errorMessage && errorMessage.indexOf('no such table') === -1) {
      //     return resolve({ result: [] });
      //   }

      //   const sql = 'SELECT name AS value from #{table} WHERE type = ? AND name = ?';
      //   const parameters = ['table', tableName];
      //   execute(dbName, MASTER_TABLE_NAME, [sql, parameters])
      //     .then((response) => {
      //       if (response.result.length === 0) {
      //         return resolve({ result: [] });
      //       }
      //       return reject(new KinveyError(`Unable to open a transaction for the ${tableName} collection on the ${dbName} WebSQL database.`));
      //     })
      //     .catch(reject);
      // });
    } catch (error) {
      reject(error);
    }
  });
}

export async function find(dbName, tableName) {
  const response = await execute(dbName, tableName, [['SELECT value FROM #{table}']]);
  return response.result;
}

export async function count(dbName, tableName) {
  const docs = await find(dbName, tableName);
  return docs.length;
}

export async function findById(dbName, tableName, id) {
  const response = await execute(dbName, tableName, [['SELECT value FROM #{table} WHERE key = ?', [id]]]);
  return response.result.shift();
}

export async function save(dbName, tableName, docs = []) {
  const sqlQueries = docs.map((doc) => ['REPLACE INTO #{table} (key, value) VALUES (?, ?)', [doc._id, JSON.stringify(doc)]]);
  await execute(dbName, tableName, sqlQueries, true);
  return docs;
}

export async function removeById(dbName, tableName, id) {
  await execute(dbName, tableName, [['DELETE FROM #{table} WHERE key = ?', [id]]], true);
}

export async function clear(dbName, tableName) {
  await execute(dbName, MASTER_TABLE_NAME, [[`DROP TABLE IF EXISTS '${tableName}'`]], true);
  return true;
}

export async function clearAll(dbName) {
  const response = await execute(dbName, MASTER_TABLE_NAME, [['SELECT name AS value FROM #{collection} WHERE type = ?', ['table']]]);
  const tables = response.result;

  if (tables.length > 0) {
    const sqlQueries = tables
      .filter(table => (/^[a-zA-Z0-9-]{1,128}/).test(table))
      .map(table => [`DROP TABLE IF EXISTS '${table}'`]);
    await execute(dbName, MASTER_TABLE_NAME, sqlQueries, true);
  }

  return true;
}
