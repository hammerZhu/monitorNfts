//本程序用来更新钱包列表
//从dune中找到近14天利润最高的500个钱包，和现有的钱包进行比较，如果现有钱包的利润太低，则用新钱包替换掉。

//本程序用来更新钱包的14天利润表
//14天利润来源于dune文件，输入文件，更新到数据库中。


const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('trades.db', { warn: console.log });


function updateProfit(filename){
    //打开文件，读取记录内容，分行。
    var buf=fs.readFileSync(filename);
    var strs=buf.toString().split('\n');
    //处理数据到数组里。
    var item={account:'0',buy:0,sell:0,profit:0};
    for(var i=0;i<strs.length;i++){
        if(i%4==0){
            item.account=strs[i];
        }
        if(i%4==1){
            item.profit=parseFloat(strs[i]);
        }
        if(i%4==2){
            item.sell=parseFloat(strs[i]);
        }
        if(i%4==3){
            item.buy=parseFloat(strs[i]);
            var profit1=Math.floor(item.profit);
            var rate1=Math.floor(item.profit*100/item.buy);
            console.log(item.account+","+profit1+","+rate1);
            //更新数据库内容。
            var query0=db.prepare("insert into wallet0904 values(?,?,?)");
            var result=query0.run(item.account,profit1,rate1);
        }
    }
}

updateProfit("profit0904.txt");

/*创建钱包利润表
 create table wallet0904 (
    account char42 not null primary key,
    profit INTEGER, 
    rate INTEGER
);
 */
