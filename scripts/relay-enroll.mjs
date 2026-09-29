import http from 'node:http';
let input='';
for await (const chunk of process.stdin) { input+=chunk; if(input.length>8192)throw new Error('Input too large'); }
const req=http.request({host:'127.0.0.1',port:8052,path:'/enroll',method:'POST',timeout:15000,headers:{'Content-Type':'application/json'}},res=>{
  res.pipe(process.stdout); if(res.statusCode!==200)process.exitCode=1;
});
req.on('error',()=>{console.error('VPS enrollment unavailable');process.exitCode=1;});
req.on('timeout',()=>req.destroy());req.end(input);
