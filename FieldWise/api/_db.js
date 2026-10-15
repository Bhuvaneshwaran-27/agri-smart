import {createClient} from '@supabase/supabase-js';
export function db(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('Missing Supabase environment variables');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
export function json(res,status,body){res.setHeader('Cache-Control','no-store');return res.status(status).json(body)}
