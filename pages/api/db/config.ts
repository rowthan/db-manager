import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getCollectionConfig,
  saveCollectionConfig,
} from '../../../service/server/mongodb'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === 'GET') {
      const database = req.query.database?.toString().trim() || ''
      const collection = req.query.collection?.toString().trim() || ''
      const config = await getCollectionConfig(database, collection)
      return res.status(200).json(config)
    }

    if (req.method === 'POST') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      const config = await saveCollectionConfig(payload || {})
      return res.status(200).json(config)
    }

    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '配置操作失败'
    return res.status(400).json({ ok: false, error: message })
  }
}
