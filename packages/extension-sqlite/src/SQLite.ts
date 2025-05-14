import type { DatabaseConfiguration } from '@hocuspocus/extension-database'
import { Database } from '@hocuspocus/extension-database'
import sqlite3 from 'sqlite3'
import kleur from 'kleur'

export const schema = `CREATE TABLE IF NOT EXISTS "documents" (
  "name" varchar(255) NOT NULL,
  "data" blob NOT NULL,
  UNIQUE(name)
)`

export const selectQuery = `
  SELECT data FROM "documents" WHERE name = $name ORDER BY rowid DESC
`

export const upsertQuery = `
  INSERT INTO "documents" ("name", "data") VALUES ($name, $data)
    ON CONFLICT(name) DO UPDATE SET data = $data
`

const SQLITE_INMEMORY = ':memory:'

export interface SQLiteConfiguration extends DatabaseConfiguration {
  /**
   * 有效值为文件名、":memory:" 用于匿名内存数据库和空字符串用于匿名磁盘数据库。匿名数据库不会持久化，
   * 当关闭数据库句柄时，它们的内容会丢失。
   *
   * https://github.com/mapbox/node-sqlite3/wiki/API#new-sqlite3databasefilename-mode-callback
   */
  database: string,
  /**
   * 要创建的数据库模式。
   */
  schema: string,
}

export class SQLite extends Database {
  db?: sqlite3.Database

  configuration: SQLiteConfiguration = {
    database: SQLITE_INMEMORY,
    schema,
    fetch: async ({ documentName }) => {
      return new Promise((resolve, reject) => {
        this.db?.get(selectQuery, {
          $name: documentName,
        }, (error, row) => {
          if (error) {
            reject(error)
          }

          resolve((row as any)?.data)
        })
      })
    },
    store: async ({ documentName, state }) => {
      this.db?.run(upsertQuery, {
        $name: documentName,
        $data: state,
      })
    },
  }

  constructor(configuration?: Partial<SQLiteConfiguration>) {
    super({})

    this.configuration = {
      ...this.configuration,
      ...configuration,
    }
  }

  async onConfigure() {
    this.db = new sqlite3.Database(this.configuration.database)
    this.db.run(this.configuration.schema)
  }

  async onListen() {
    if (this.configuration.database === SQLITE_INMEMORY) {
      console.warn(`  ${kleur.yellow('SQLite 扩展配置为内存数据库。所有更改将在重启时丢失!')}`)
      console.log()
    }
  }
}
