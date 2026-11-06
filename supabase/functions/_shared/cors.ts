const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://shop.anniepetars.com',
  'http://shop.anniepetars.com',
  'https://anniepetars.com',
  'https://www.anniepetars.com',
]
export function getCorsHeaders(req: Request): Record<string,string> {
  const origin=req.headers.get('origin') || ''
  return {'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials':'true','Vary':'Origin'}
}
