import {db,json} from './_db.js';
const crops=['Not selected','Rice','Wheat','Cotton','Tomato'];
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'POST required'})}
 if(!process.env.DEVICE_API_KEY||req.headers['x-device-key']!==process.env.DEVICE_API_KEY)return json(res,401,{error:'Invalid device key'});
 const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b))return json(res,400,{error:'JSON object required'});
 const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(!Number.isInteger(b.crop_code)||b.crop_code<0||b.crop_code>4||b.crop_name!==crops[b.crop_code]||!num(b.soil_moisture,0,100)||!num(b.soil_raw,0,4095)||!num(b.wifi_rssi,-120,0))return json(res,400,{error:'Invalid crop or soil data'});
 for(const [k,lo,hi] of [['temperature_c',-40,85],['humidity_pct',0,100]])if(b[k]!==null&&!num(b[k],lo,hi))return json(res,400,{error:`Invalid ${k}`});
 for(const k of ['pump_on','irrigation_required','safety_lockout','human_motion'])if(typeof b[k]!=='boolean')return json(res,400,{error:`Invalid ${k}`});
 const row={device_id:typeof b.device_id==='string'?b.device_id.slice(0,64):'fieldwise-esp32-01',crop_code:b.crop_code,crop_name:b.crop_name,soil_moisture:b.soil_moisture,soil_raw:b.soil_raw,temperature_c:b.temperature_c,humidity_pct:b.humidity_pct,pump_on:b.pump_on,irrigation_required:b.irrigation_required,safety_lockout:b.safety_lockout,human_motion:b.human_motion,wifi_rssi:b.wifi_rssi};
 try{const {data,error}=await db().from('sensor_readings').insert(row).select('id,created_at').single();if(error){console.error(error);return json(res,500,{error:'Database insert failed'})}return json(res,201,{ok:true,...data})}catch(e){console.error(e);return json(res,500,{error:'Server error'})}
}
