import { NestFactory } from '@nestjs/core';
import { AppApiModule } from '../app-api.module';
import { RpcService } from '../services/rpc/rpc.service';

async function getBtcTxMetadata(txid: string) {
  const app = await NestFactory.create(AppApiModule);
  const rpcService = app.get(RpcService);

  try {
    // 获取原始交易信息
    const response = await rpcService.getRawTransaction(txid, 1);
    const rawTx = response.data.result;

    // 提取需要的元数据
    const vout = rawTx.vout.map((output: any) => ({
      value: output.value,
      n: output.n,
      scriptPubKey: output.scriptPubKey,
      address: output.scriptPubKey.address || output.scriptPubKey.addresses?.[0] || null,
    }));

    console.log('Transaction outputs:', JSON.stringify(vout, null, 2));

    // 提取所有输出的地址
    const outputAddresses = vout
      .map((output) => output.address)
      .filter((address) => address !== null);

    console.log('Output addresses:', JSON.stringify(outputAddresses, null, 2));

    // 关闭 NestJS 应用
    await app.close();

    // 返回输出地址数组
    return outputAddresses;
  } catch (error) {
    console.error('获取交易元数据时出错:', error);
    // 确保在出错时也关闭 NestJS 应用
    await app.close();
    throw error;
  }
}

// 使用示例
const txid = process.argv[2];
if (!txid) {
  console.error('请提供交易ID作为命令行参数');
  process.exit(1);
}

getBtcTxMetadata(txid).catch((error) => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
