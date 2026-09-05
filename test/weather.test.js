import test from "node:test";
import assert from "node:assert/strict";
import {getWeather} from "../server/services/weather.js";
import {marketRegion} from "../server/services/locations.js";

test("regional prices never default an unknown farmer to Nashik",()=>{
  assert.equal(marketRegion({location:"Jaipur"}),null);
  assert.deepEqual(marketRegion({location:"Dindori"}),["Maharashtra","Nashik"]);
  assert.deepEqual(marketRegion({region_state:"Tamil Nadu",region_district:"Chennai district"}),["Tamil Nadu","Chennai"]);
});
test("weather uses exact selected coordinates, preserves dates, and fails without sample numbers",async()=>{
  const original=global.fetch;
  try {
    let requested;
    global.fetch=async url=>{
      requested=new URL(url);
      return {ok:true,json:async()=>({timezone:"Asia/Kolkata",current:{temperature_2m:30,wind_speed_10m:5,time:"2026-09-05T12:00"},daily:{time:["2026-09-05"],precipitation_probability_max:[80],precipitation_sum:[4]}})};
    };
    const weather=await getWeather("Chennai",13.08,80.27);
    assert.equal(requested.searchParams.get("latitude"),"13.08");
    assert.equal(requested.searchParams.get("longitude"),"80.27");
    assert.equal(weather.available,true);
    assert.equal(weather.daily[0].date,"2026-09-05");
    global.fetch=async()=>{throw Error("offline");};
    const failed=await getWeather("Chennai",13.08,80.27);
    assert.equal(failed.available,false);
    assert.equal(failed.temperature,null);
    assert.equal(failed.rainProbability,null);
  } finally {global.fetch=original;}
});
