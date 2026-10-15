import {db,json} from './_db.js';
const DEVICE='fieldwise-esp32-01';
const crops=['Not selected','Rice','Wheat','Cotton','Tomato'];
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'){
  if(!process.env.DEVICE_API_KEY||req.headers['x-device-key']!==process.env.DEVICE_API_KEY)return json(res,401,{error:'Invalid device key'});
  try{const {data,error}=await db().from('device_commands').select('crop_code,revision').eq('device_id',DEVICE).single();if(error)throw error;return json(res,200,data)}catch(e){console.error(e);return json(res,500,{error:'Command read failed'})}
 }
 if(req.method==='POST'){
  if(!process.env.DASHBOARD_ADMIN_KEY||req.headers['x-admin-key']!==process.env.DASHBOARD_ADMIN_KEY)return json(res,401,{error:'Invalid dashboard admin key'});
  const code=req.body?.crop_code;if(!Number.isInteger(code)||code<0||code>4)return json(res,400,{error:'Invalid crop code'});
  try{const {data,error}=await db().rpc('set_device_crop',{p_device_id:DEVICE,p_crop_code:code});if(error)throw error;return json(res,200,{ok:true,crop_code:code,crop_name:crops[code],revision:data})}catch(e){console.error(e);return json(res,500,{error:'Command update failed'})}
 }
 res.setHeader('Allow','GET, POST');return json(res,405,{error:'Unsupported method'});
}
