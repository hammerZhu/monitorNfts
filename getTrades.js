'use strict';

//本文件用来抓取nft交易数据，方法是分析opensea等交易所的交易日志
//通过etherscan得到合约的地址和日志的topic0，作为关键字查找日志。
//解析日志的data得到日志的具体数据，日志的数据格式是固定的，可以参考etherscan来得到。
//不同交易所的日志不相同，这里优先处理最常用的opensea seaport的记录。

var Web3 =require('web3');
var Web3HttpProvider = require('web3-providers-http');
const fs = require('fs');
var Contract = require('web3-eth-contract');
const Database = require('better-sqlite3');
const { assert } = require('console');
const { resolve } = require('dns');
const db = new Database('trades.db', { warn: console.log });
const readline=require('readline');
//const HttpsProxyAgent = require('https-proxy-agent');

//var myProxy=new HttpsProxyAgent("http://127.0.0.1:49274");
var options = {
    keepAlive: true,
    withCredentials: false,
    timeout: 20000, // ms
    headers: [
        {
            name: 'Access-Control-Allow-Origin',
            value: '*'
        }
    ],
   // agent: {
    //    https: myProxy,
    //}
};

var provider = new Web3HttpProvider('https://mainnet.infura.io/v3/f90be7e4beaa430d924699c403b9892f', options);
var web3 = new Web3(provider);
var BN = web3.utils.BN;


const monitorWallets=new Set();

const configLooksRareBid={
    address:'0x59728544b08ab483533076417fbbb2fd0b17ce3a',
    topic0:'0x95fb6205e23ff6bda16a2d1dba56b9ad7c783f67c96fa149785052f47696f2be',
    handler:handleLooksrareBidEvent,
};
const configLooksRareAsk={
    address:'0x59728544b08ab483533076417fbbb2fd0b17ce3a',
    topic0:'0x68cd251d4d267c6e2034ff0088b990352b97b2002c0476587d0c4da889c11330',
    handler:handleLooksrareAskEvent,
};
const configOpenSeaWyvernExchange={
    address:'0x7f268357a8c2552623316e2562d90e642bb538e5',
    topic0:'0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9',
    handler:handleLooksrareAskEvent,
};
const configOpenSeaSeaport={
    address:'0x00000000006c3852cbef3e08e8df289169ede581',
    topic0:'0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31',
    handler:handleSeaportEvent,
};
const skipCollections=[
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',//weth
    '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85',//ens
];

function inSkipCollections(contract){
    var ret=false;
    //
    var lowContract=contract.toLowerCase(contract);
    for(var i=0;i<skipCollections.length;i++){
        if(lowContract==skipCollections[i]){
            ret=true;
            break;
        }
    }
    return ret;
}

/**
 * @note 根据配置，处理对应合约的日志，解析后写入到数据库中。
 * @param config 配置文件。
 * @param startBlock 开始区块
 * @param endBlock 结束区块
 *  */
async function handleEvents(startBlock,endBlock,config){
    var options={
        fromBlock:startBlock,
        toBlock:endBlock,
        address:config.address,
        topics:[config.topic0]
    };
    //先看一下交易记录有多少条再说。
    var recp=await web3.eth.getPastLogs(options);
    console.log("Get block to "+endBlock+",events length="+recp.length);
    config.handler(recp);
}
//待处理的是event数组。
function handleLooksrareBidEvent(events){

    for(var idx=0;idx<events.length;idx++){
        //todo过滤掉不符合要求的记录
        var block=events[idx].blockNumber;
        var buyer=str64ToAddress(events[idx].topics[1].substring(2));
        var seller=str64ToAddress(events[idx].topics[2].substring(2));
        
        var price=str64ToMicroEth(getDataString(events[idx].data,6));
        var contractAddress=str64ToAddress(getDataString(events[idx].data,3)); 
        //保存到数据库中
        //insertToTable(block,buyer,seller,price,contractAddress);
    }
}
function handleLooksrareAskEvent(events){
    for(var idx=0;idx<events.length;idx++){
        //todo过滤掉不符合要求的记录
        
        var block=events[idx].blockNumber;
        var buyer=str64ToAddress(events[idx].topics[2].substring(2));
        var seller=str64ToAddress(events[idx].topics[1].substring(2));
        
        var price=str64ToMicroEth(getDataString(events[idx].data,6));
        var contractAddress=str64ToAddress(getDataString(events[idx].data,3)); 
        //保存到数据库中
        //insertToTable(block,buyer,seller,price,contractAddress);
    }
}

//events是查询到的结果。
function handleSeaportEvent(events){
    for(var idx=0;idx<events.length;idx++){
        //过滤掉不符合要求的记录
        var seller=str64ToAddress(events[idx].topics[1].substring(2));
        var buyer=str64ToAddress(getDataString(events[idx].data,1));

        var block=events[idx].blockNumber;
        var nftNumber=str64ToInt(getDataString(events[idx].data,4))
        if(nftNumber>20){
            console.log("error nft number:"+nftNumber);
            continue;
        }
        var price=str64ToMicroEth(getDataString(events[idx].data,9+4*nftNumber));
        var fee1=str64ToMicroEth(getDataString(events[idx].data,14+4*nftNumber));
        var fee2=str64ToMicroEth(getDataString(events[idx].data,19+4*nftNumber));
        price=(price+fee1+fee2)/nftNumber;
        if(price<=10000){//filter less than 0.01e
            continue;
        }
        for(var j=0;j<nftNumber;j++){
            var contractAddress=str64ToAddress(getDataString(events[idx].data,6+4*j)); 
            if(inSkipCollections(contractAddress)){
                break;
            }
            var tokenId=str64ToInt(getDataString(events[idx].data,7+4*j));
            //保存到数据库中
            //console.log("insert to table");
            insertToTable(block,buyer,seller,price,contractAddress,tokenId);
        }
    }
}
function handleWyvernExchangeEvents(datas){
    for(var idx=0;idx<events.length;idx++){
        //todo过滤掉不符合要求的记录
        
        var block=events[idx].blockNumber;
        var seller=str64ToAddress(events[idx].topics[1].substring(1));
        var buyer=str64ToAddress(events[idx].topics[1].substring(2));
        var price=str64ToMicroEth(getDataString(events[idx].data,2));
        var contractAddress=str64ToAddress(getDataString(events[idx].data,3)); 
        //保存到数据库中
        insertToTable(block,buyer,seller,price,contractAddress);
    }
}
function getDataString(hexstr,index){
    return hexstr.substring(2+64*index,index*64+66);
}
function str64ToInt(hexstr){
    var ret="0x"+hexstr;
    return parseInt(ret);
}
//输入长度64字符串（不带0x），输出地址。
function str64ToAddress(hexstr){
    var ret="0x"+hexstr.substring(24);
    return ret;
}
//输出长度64字符串（hex不带0x）,输出0.001eth的倍数。
function str64ToMicroEth(hexstr){
    var bn=new BN("0x"+hexstr);
    var nstr=web3.utils.fromWei(bn,'microether');
    return parseInt(nstr);
}
//把数组bytes32的字符串转换成BN数组
function convertStringToBNArray(hexstr){
    var arrayNum=(hexstr.length-2)/64;
    var res=new Array(arrayNum);
    for(var i=0;i<arrayNum;i++){
        var dataStr="0x"+hexstr.substring(2+64*i,66+64*i);
        var bn=new BN(dataStr);
        res[i]=bn;
    }
    return res;
}
async function mssleep(millseconds){
    return new Promise(resolve=> setTimeout(resolve,millseconds));
}
function insertToTable(block,buyer,seller,price,contract,tokenid){
    //console.log("======insert record========");
    //console.log("block="+block);
    //console.log("price="+price);
    //console.log("contract="+contract);
    //return;
    const append1=db.prepare('insert into trades values (?,?,?,?,?,?)');
    var result=append1.run(block,buyer,seller,price,contract,tokenid);
    if(result.changes==1){
        return true;
    }
    return false;
}

async function mainLoop(){
    //获取当前的区块，
    const latestNumber =await web3.eth.getBlockNumber();
    console.log("newest block="+latestNumber);
    //获取上次查询的区块
    const query1=db.prepare("select block from trades order by block desc limit 1");
    var result=query1.get();
    var lastBlock;
    if(result!=undefined){
        lastBlock=result.block;
    }
    else{
        lastBlock=15300000;//没有开头给定开头。
    }
    console.log("last block="+lastBlock);
    await mssleep(5000);
    //每次查询100个区块。
    for(var i=lastBlock+1;i<=latestNumber;i+=100){
    //for(var i=15243470;i<=15300000;i+=100){
        //每次查询100个区块，查询opensea seaport.
        var endb=i+99;
        if(endb>latestNumber){
            endb=latestNumber;
        }
        await handleEvents(i,endb,configOpenSeaSeaport);
        await mssleep(5000);
    }
    //分别查询所有合约的数据。
}


//主程序部分

mainLoop();
/*
create table trades (
    block INTEGER, 
    buyer char42,
    seller char42,
    price INTEGER,
    contract char42,
    tokenid INTEGER
);*/

