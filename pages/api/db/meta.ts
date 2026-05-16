import type { NextApiRequest, NextApiResponse } from 'next'
import { getMongoMeta } from '../../../service/server/mongodb'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const database = req.query.database?.toString() || undefined
  const meta = await getMongoMeta(database)
  return res.status(meta.ok ? 200 : 503).json(meta)
}
