//分析数据。按照时段来区分，每个时段300区块。
//买入分析，找出前20的买入
//卖出指标。
//最后统计策略收益。
//每周区块个数44208
//第二版，该用macd数据来指导卖出，还有止盈止损数据。
'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');
const { start } = require('repl');

const db = new Database('trades.db', { warn: console.log });


//交易记录表
var tradeRecords=new Array();
const maxCash=5000000;
var cash;//开始现金5e。
var startTradeBlock=0;//开始时间段
var SellingList=new Array();//待卖出列表
var mapMACD=new Map();
const IntervalMACD=614;
//统计指定时间点，后退12个时段的买入记录。
//如果一个项目买入量>?,卖出量<?，则进行买入操作。
//买入价格为后续买入的最低价格。
//options包括，buy，sell，buyscale，sellscale

//返回
function analysis1(blockNumber,options){
    //处理上个周期的卖出数据
    handleSellingList(blockNumber);

    //console.log("check blockNumber======"+blockNumber+"========");
    const pastBlocks=2456;//用前8小时的交易记录进行参考。
     //计算blockNumber和前12个时段的买入和卖出记录。
    var query1=db.prepare("select t.contract,count(*) as num from buyRecord t inner join wallets w on t.buyer=w.account  where block>? and block<? group by t.contract order by num desc");
    var result1=query1.all(blockNumber-pastBlocks,blockNumber);
   // console.log("get buy num="+result1.length);
   // console.log(result1);
    
    var query2=db.prepare("select t.contract,count(*) as num from sellRecord t inner join wallets w on t.seller=w.account where block>? and block<? group by t.contract order by num desc");
    var result2=query2.all(blockNumber-pastBlocks,blockNumber);
   // console.log("get sell num="+result2.length);
   // console.log(result2);
    
    //买入和卖出的map，记录contract和数量。
    var buyerMap=new Map();
    for(var i=0;i<result1.length;i++){
        buyerMap.set(result1[i].contract,result1[i].num);
    }
    var sellerMap=new Map();
    for(var i=0;i<result2.length;i++){
        sellerMap.set(result2[i].contract,result2[i].num);
    }
    //处理买入的项目
    for(var i=0;i<result1.length;i++){
        var sellNum=0;
        for(var j=0;j<result2.length;j++){
            if(result1[i].contract==result2[j].contract){
               sellNum=result2[j].num;
               break;
            }
        }
        handleBuyingContract(blockNumber,result1[i].contract,options,result1[i].num,sellNum);
        handleSellingContract(blockNumber,result1[i].contract);
    }

}
//根据买入和卖出数量来处理项目。
function handleBuyingContract(blockNumber,contract,options,buyNum,sellNum){
    if(buyNum<10 && sellNum<10){
        return;
    }
    //console.log("handleContract:"+blockNumber+ ","+contract.substring(0,6)+","+buyNum+","+sellNum)
    if(buyNum>sellNum){
       
        if(buyNum>=options.buy*options.num/100 && sellNum<buyNum*options.sellScale/100){
            buyItem(contract,blockNumber);
        }
    }
}

//尝试卖出NFT
function handleSellingContract(blockNumber,contract){
    //检测是否买入过该项目，且没有卖出，没有买过不处理。
    var noBuied=true;
    var buyNum=0;
    for(var i=0;i<tradeRecords.length;i++){
        if(tradeRecords[i].contract==contract && tradeRecords[i].sellBlock==0){
            noBuied=false;
            buyNum=tradeRecords[i].num;
            break;
        }
    }
    if(noBuied){
        return;
    }
    //如果已经在卖出列表中，不处理。
    var inSelling=false;
    for(var i=0;i<SellingList.length;i++){
        if(SellingList[i]==contract){
            inSelling=true;
            break;
        }
    }
    if(inSelling){
        return;
    }
    //检查macd表格。
    var macd1=makeMACD(contract,blockNumber);
    //if(contract=='0xcca8050215e585e2a223c6ea9d1d1f9b30beaf3e'){
    //    console.log("MYNFT:"+blockNumber+","+macd1.bar+","+macd1.maxBar);
    //}
    if(macd1.maxBar>0 && macd1.bar*2<macd1.maxBar){
         //如果不在交易时间段，不可卖出
        if(!timeCanTrade(blockNumber)){
            return false;
        }
        var price1=getPrice(contract,blockNumber)-1000;//降价0.001e，容易卖出。
        var item={contract:contract,price:price1,num:buyNum};
        SellingList.push(item);
        //console.log("Add to Sell:"+blockNumber+","+contract.substring(0,6)+","+macd1.bar+","+macd1.maxBar);
    }
}
//判断当前时间点是否能交易。
function timeCanTrade(block){
    var index=(block-startTradeBlock)/614;
    if(index%12>7){
        return false;
    }
    return true;
}
//获取项目block前6小时交易量。
function getLastHourNum(contract,block){
    var query0=db.prepare("select count(*) as num from trades where contract=? and block>? and block<?");
    var result=query0.get(contract,block-307*6,block);
    return result.num;
}
//获取项目在block开始后的最新价格。单位百万分之1e。
//优先提取时间段之后的数据，如果没有，则提取时间段之前的数据来补充。
//共提取5个数据，选择最底的成交价格。
//返回的价格已经扣除了opensea的手续费。
function getPrice(contract,block){
    //var query0=db.prepare("select price,block from trades where contract=? and block>? order by block limit 5");
   // var result=query0.all(contract,block);
   // if(result.length==0){
        var query1=db.prepare("select price,block from trades where contract=? and block<? order by block desc limit 5");
        var result=query1.all(contract,block);
  //  }
    //console.log(result);
    if(result.length==0){
        console.log("find not price")
        return 0;
    }
    var minPrice=999000000;//999eth
    for(var i=0;i<result.length;i++){
        if(minPrice>result[i].price){
            minPrice=result[i].price;
        }
    }
    return minPrice*0.95;
}


//买入,每次最多买入0.7e,钱不够则不买
function buyItem(contract,block){
    const buyingGas=3000;
    //如果不在交易时间段，不可买入
    if(!timeCanTrade(block)){
        return;
    }
    //如果已经买入，则不再重复买入
    var hasBuied=false;
    for(var j=0;j<tradeRecords.length;j++){
        if(contract==tradeRecords[j].contract){
            hasBuied=true;
            break;
        }
    }
    if(hasBuied){
        return;
    }
    //查询价格
    var price=getPrice(contract,block)+buyingGas;
    var buyNum=Math.floor(700000/price);
    if(buyNum<1){
        return;
    }
    if(buyNum>6){
        buyNum=6;
    }
    //现金不足不能买入
    if(cash<price*buyNum){
        return ;
    }
    cash=cash-price*buyNum;
    //console.log("block:"+block+" buy item:"+tradeRecords.length+","+contract.substring(0,6)+",num="+buyNum+",price="+price);
    //添加交易记录
    var tradeRec={
        block:block,
        contract:contract,
        buyPrice:price,
        num:buyNum,
        sellPrice:0,
        sellBlock:0
    };
    tradeRecords.push(tradeRec);
    //清除最大的macd
    var macd=mapMACD.get(contract);
    if(macd!=undefined){
        macd.maxBar=0;
    }
}

//尝试卖出nft。
function handleSellingList(blockNumber){
    //对照卖出列表中的队列，判断2小时内是否能够卖出。
    for(var j=0;j<SellingList.length;j++){
        const query=db.prepare("select count(*) as num from trades where block>? and block<=? and contract=? and price>=?");
        //能够卖出的条件是，含有3个或以上价格大于等于该出价的项目。
        var result=query.get(blockNumber-614,blockNumber,SellingList[j].contract,SellingList[j].price*100/95);
        
        if(result.num>2+SellingList[j].num){//能够卖出后，添加到卖出记录表。
            for(var i=0;i<tradeRecords.length;i++){
                if(SellingList[j].contract==tradeRecords[i].contract){
                    tradeRecords[i].sellPrice=SellingList[j].price;
                    tradeRecords[i].sellBlock=blockNumber;
                    cash+=tradeRecords[i].sellPrice*tradeRecords[i].num;
                    //console.log("Sell item:"+blockNumber+","+SellingList[j].contract.substring(0,6)+","+SellingList[j].price);
                    break;
                }
            }
            //删除元素
            SellingList.splice(j, 1);
            j--;
        }
        else{
            console.log("Sell failed:"+blockNumber+","+SellingList[j].contract.substring(0,6));
        }
    }
}

//计算收益,按照买入比例和卖出比例来计算。
function excuteOptions(tablename,startBlock,numBlock){
    var endBlock=startBlock+numBlock;
    var options={
        num:20,
        buy:30,
        sell:100,
        buyScale:100,
        sellScale:50
    };
    //读取有效的记录条数。
    options.num=500;
    createWallets(tablename,options.num);
    createBuyAndSellRecords(startBlock-7368,endBlock);
    startTradeBlock=startBlock;
    
    var resultArray=new Array();
    for (var s1=4;s1<=16;s1+=4){
        for(var s4=40;s4<=100;s4+=20){
            options.buy=s1;
            options.sellScale=s4;
            
            tradeRecords=[];
            //console.log("=================new strate=========");
            //console.log("buy="+s1+",sellScale="+options.sellScale);
            //设置全局变量
            cash=maxCash;
            SellingList=new Array();
            mapMACD=new Map();
            //执行买入和卖出操作
            for(var i=0;i<=numBlock;i+=614){
                analysis1(startBlock+i,options);
            }

            var profit=caculateProfit(endBlock);
            var profitRecord={
                profit:JSON.parse(JSON.stringify(profit)),
                option:JSON.parse(JSON.stringify(options)) 
            };
            resultArray.push(profitRecord);
            
        }
    }
    //找到最大利润的策略
    for(var i=resultArray.length-1;i>=0;i--){
        for(var j=0;j<i;j++){
            if(resultArray[j].profit.profit<resultArray[j+1].profit.profit){
                var temp=resultArray[j];
                resultArray[j]=resultArray[j+1];
                resultArray[j+1]=temp;
            }
        }
    }
    //输出结果到文件,取前40名
    //var outFile=tablename+".csv"
    //fs.writeFileSync(outFile,"账面利润,最大投入,剩余现金,账面价值,总买入,总卖出,买入门槛,卖出上限,卖出门槛,买入上限\n");
    console.log("\n\n======"+startBlock+"========"+endBlock+"=========\n");
    console.log("账面利润,最大投入,剩余现金,账面价值,总买入,总卖出,买入门槛,卖出上限,卖出门槛,买入上限");
    for(var i=0;i<10;i++){
        var options=resultArray[i].option;
        var result=resultArray[i].profit;
        var wstr=(Math.floor(result.profit)).toString()+","+(Math.floor(result.maxCost)).toString()+","+(Math.floor(result.restMoney)).toString()+","+(Math.floor(result.restValue)).toString()+","+(Math.floor(result.buyAll)).toString()+","+(Math.floor(result.sellAll)).toString()+","+options.buy+","+options.sellScale;
        console.log(wstr);
        //fs.writeFileSync(outFile,)
    }
}
//从最新的数据推后分析。
//操作一个策略，输出详细的买入卖出结果。
function operation2(tablename,startBlock,blockNumber){
    var endBlock=startBlock+blockNumber;
    var options={
        buy:12,
        sellScale:60,//卖出量高于80%则不能买入。
        sell:100,
        buyScale:100,
        
    };
    tradeRecords=[];
    startTradeBlock=startBlock;
    
    options.num=500;
    //createWallets(tablename,options.num);
    //createBuyAndSellRecords(startBlock-7368,endBlock);
    cash=maxCash;
    for(var i=0;i<=blockNumber;i+=614){
        analysis1(startBlock+i,options);
    }
   
    var result=caculateProfit(endBlock);
    //console.log(result);
    console.log("交易区间："+startBlock+"--"+endBlock);
    console.log("最大投入="+result.maxCost+",结余现金="+result.restMoney+",账面价值="+result.restValue);
    console.log("账面利润="+result.profit+",总买入="+result.buyAll+",总卖出="+result.sellAll);

}



//统计tradeRecords的收益情况，返回一个对象。
//买入需要加入气费，卖出需要减去opensea手续费,已经包含在价格中了。
function caculateProfit(endBlock){
    var result={
        maxCost:0,//最大投入
        restValue:0,//最后的现金
        restMoney:0,//账面价值
        buyAll:0,
        sellAll:0,
        profit:0,
    };
    //统计利润和买入卖出需要金额
    var cost=0;//当前投入，买入为正，负数表示有收入。
    var maxCost=0;//最大投入。
    var totalBuy=0;
    var totalSell=0;
    var valueNoSell=0;
    var sellArray=new Array();

    //提取卖出的数据。
    for(var i=0;i<tradeRecords.length;i++){
        if(tradeRecords[i].sellPrice>0){
            var sellInfo={block:tradeRecords[i].sellBlock,value:tradeRecords[i].sellPrice,num:tradeRecords[i].num};
            sellArray.push(sellInfo);
        }
    }
    //卖出的数据按卖出时间从小到大排序
    for(var i=sellArray.length-1;i>0;i--){
        for(var j=0;j<i;j++){
            if(sellArray[j].block>sellArray[j+1].block){
                var temp=sellArray[j];
                sellArray[j]=sellArray[j+1];
                sellArray[j+1]=temp;
            }
        }
    }

    //计算最大投入
    var j=0;
    for(var i=0;i<tradeRecords.length;i++){
        while(j<sellArray.length && tradeRecords[i].block>sellArray[j].block){
            cost-=sellArray[j].value*sellArray[j].num;
            j++;
        }
        cost+=tradeRecords[i].buyPrice*tradeRecords[i].num;
        if(cost>maxCost){
            maxCost=cost;
        }
    }
    //如果还有卖出没有处理，则处理
    while(j<sellArray.length){
        cost-=sellArray[j].value*sellArray[j].num;
        j++;
    }
    //计算整体利润
    //遍历买入数据，同时更新卖出数据。
    
    for(var i=0;i<tradeRecords.length;i++){
        var showRecord="item="+tradeRecords[i].contract+",num="+tradeRecords[i].num+",buy="+tradeRecords[i].buyPrice+",buyBlock="+tradeRecords[i].block;
        totalBuy+=(tradeRecords[i].buyPrice)*tradeRecords[i].num;
        
        if(tradeRecords[i].sellPrice>0){
            totalSell+=tradeRecords[i].sellPrice*tradeRecords[i].num;
            var p1=(tradeRecords[i].sellPrice-tradeRecords[i].buyPrice)*tradeRecords[i].num;
            showRecord+=",profit="+p1;
            showRecord+=",sell="+tradeRecords[i].sellPrice;
            showRecord+=",sellBlock="+tradeRecords[i].sellBlock;
        }
        else{
            var newValue=getPrice(tradeRecords[i].contract,endBlock);
            var volumn=getLastHourNum(tradeRecords[i].contract,endBlock);
            if(volumn<20){//流动性太低，归零处理。
                newValue=0;
            }
            valueNoSell+=newValue*tradeRecords[i].num;
            var p1=(newValue-tradeRecords[i].buyPrice)*tradeRecords[i].num;
            showRecord+=",paper="+p1;
            showRecord+=",value="+newValue;
        }
        //console.log(showRecord);
    }
    
    result.maxCost=maxCost;
    if(cost<0){
        result.restMoney=cost*(-1);
    }
    result.restValue=valueNoSell;
    result.sellAll=totalSell;
    result.buyAll=totalBuy;
    result.profit=valueNoSell+totalSell-totalBuy;
    return result;
}




function testAnalysis1(){
    var options={
        buy:20,
        sell:20,
        buyScale:20,
        sellScale:20,//卖出量高于80%则不能买入。
    };
    analysis1("wallet0814",15332500,options);
}
//创建临时表格，来查询数据。
function createWallets(tablename,num){
    const cmd0=db.prepare("delete from wallets");
    cmd0.run();
    const query0=db.prepare("select * from "+tablename+" order by profit desc limit ?");
    var result0=query0.all(num);
    //console.log(result0);
    for(var i=0;i<result0.length;i++){
        //console.log(result0[i]);
        const append1=db.prepare("insert into wallets values (?,?,?)");
        var result1=append1.run(result0[i].account,result0[i].profit,result0[i].rate);
    }
}
//生成买入表和卖出表
function createBuyAndSellRecords(startBlock,endBlock){
    //删除现有的数据。
    const cmd0=db.prepare("delete from buyRecord");
    cmd0.run();
    const cmd1=db.prepare("delete from sellRecord");
    cmd1.run();
    //添加买入数据
    console.log("create buy record");
    const query0=db.prepare("select * from trades t inner join wallets w on t.buyer=w.account where t.block>=? and t.block<=?");
    var result=query0.all(startBlock,endBlock);
    for(var i=0;i<result.length;i++){
        const cmd=db.prepare("insert into buyRecord values (?,?,?,?,?,?)");
        cmd.run(result[i].block,result[i].buyer,result[i].seller,result[i].price,result[i].contract,result[i].tokenid);
    }
    //添加卖出数据
    console.log("create sell record");
    const query1=db.prepare("select * from trades t inner join wallets w on t.seller=w.account where t.block>=? and t.block<=?");
    var result=query1.all(startBlock,endBlock);
    for(var i=0;i<result.length;i++){
        const cmd=db.prepare("insert into sellRecord values (?,?,?,?,?,?)");
        cmd.run(result[i].block,result[i].buyer,result[i].seller,result[i].price,result[i].contract,result[i].tokenid);
    }
}
//macd曲线用一个map，key为contract，内容包括当前macd各个指标。
//生成2小时的macd曲线。
function makeMACD(contract,endBlock){
    //如果没有找到contract，则需要访问历史数据来添加。
    var macd=mapMACD.get(contract);
    if(macd==undefined){
        //读取历史价格，构建历史macd
        var ema12=0;
        var ema26=0;
        var dea9=0;
        for(var i=26;i>0;i--){
            var history=getAvgPrice(contract,endBlock-i*IntervalMACD);
            if(history.num==0){
                continue;
            }
            if(i<=26 && ema26==0){
                ema26=history.price;
            }else
            if(i<=12 && ema12==0){
                ema12=history.price;
                dea9=ema12-ema26;
            }else{
                ema26=(ema26*25+history.price*2)/27;
                ema12=(ema12*11+history.price*2)/13;
                dea9=(dea9*8+(ema12-ema26)*2)/10;
            }
        }
        macd={};
        macd.price=history.price;
        macd.num=history.num;
        macd.eliteNum=0;
        macd.ema26=ema26;
        macd.ema12=ema12;
        macd.dea9=dea9;
        macd.maxBar=0;
        mapMACD.set(contract,macd);
    }
    //获取最新价格
    var newPrice=getAvgPrice(contract,endBlock);
    
    var elite=getBuyNum(contract,endBlock);
    var eliteSell=getSellNum(contract,endBlock);
    macd.price=newPrice.price;
    macd.num=newPrice.num;
    macd.eliteNum=elite.num;
    macd.eliteSell=eliteSell.num;
    if(newPrice.num>10){ //成交量太低，认为价格不变？？？
        macd.ema26=(macd.ema26*25+newPrice.price*2)/27;
        macd.ema12=(macd.ema12*11+newPrice.price*2)/13;
        macd.dea9=(macd.dea9*8+(macd.ema12-macd.ema26)*2)/10;
        macd.bar=2*(macd.ema12-macd.ema26-macd.dea9);
    }
    if(macd.bar>macd.maxBar){
        macd.maxBar=macd.bar;
    }
    return macd;
}
// 读取某个项目的历史价格,返回价格和数量，数量为0则价格无效。
function getAvgPrice(contract,endblock){
    const query=db.prepare("select count(*) as num,avg(price) as price from trades where block>? and block<=? and contract=?");
    var result=query.get(endblock-IntervalMACD,endblock,contract);
    //console.log(endblock+","+result.num+","+result.price);
    return result;
}
//查找某个节点，优质钱包买入个数
function getBuyNum(contract,endblock){
    const query=db.prepare("select count(*) as num from trades t inner join wallets w on t.buyer=w.account where block>? and block<=? and contract=?");
    var result=query.get(endblock-IntervalMACD,endblock,contract);
    //console.log(endblock+","+result.num+","+result.price);
    return result;
}
function getSellNum(contract,endblock){
    const query=db.prepare("select count(*) as num from trades t inner join wallets w on t.seller=w.account where block>? and block<=? and contract=?");
    var result=query.get(endblock-IntervalMACD,endblock,contract);
    //console.log(endblock+","+result.num+","+result.price);
    return result;
}


function testMacd(contract){
    console.log("区块,数量,买入数量，价格,bar,dea9,ema12,ema26");
    for(var i=0;i<44208/IntervalMACD;i++){
        var endblock=15424590+i*IntervalMACD;
        var macd=makeMACD(contract,endblock);
        console.log(endblock+","+macd.num+","+macd.eliteNum+","+macd.eliteSell+","+Math.floor(macd.price)+","+Math.floor(macd.maxBar)+","+Math.floor(macd.bar)+","+Math.floor(macd.dea9)+","+Math.floor(macd.ema12)+","+Math.floor(macd.ema26));
    }
}
function excute1Month(){
    var tables=["wallet0807","wallet0814","wallet0821","wallet0828"];
    var blocks=[15291832,15336460,15380672,15424590];
    for(var i=0;i<4;i++){
        excuteOptions(tables[i],blocks[i],44208);
    }
}
//excute1Month();
//addWallets();
//testAnalysis1();
//excuteOptions("wallet0828",15424590,44208);
operation2("wallet0828",15424590,44208);
//testMacd('0x1895c2da9155d7720a7957da06ce898a6a29d0a7');
//getCollectionValues('0x27787755137863bb7f2387ed34942543c9f24efe',15159000,49000);
//calProfitForWallets('0xacdcaadb137c319f98826b6165ae54d41ea29971',15332500,15381500);
//profitAllWallets(15283500,15381500);
//filterWallets();
//createBuyAndSellRecords(15288300,15298300);


/*create table buyRecord (
    block INTEGER, 
    buyer char42,
    seller char42,
    price INTEGER,
    contract char42,
    tokenid INTEGER
);
回测时间段：
0724:15199900-15244100
0731:15244100-15288300
0807:15288300-15332500
0814:15332500-15376700
0821:15376700-15420900
*/
