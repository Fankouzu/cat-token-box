import { DataSource, In } from 'typeorm';
import { TxOutEntity } from '../entities/txOut.entity';
import { PkhToAddressEntity } from '../entities/pkhToAddress.entity';
import { ormConfig } from '../config/db.config';
import axios from 'axios';
import { ownerAddressToPubKeyHash } from '../common/utils';
import { TokenMintEntity } from '../entities/tokenMint.entity';
import { TxEntity } from '../entities/tx.entity';
import { TokenInfoEntity } from '../entities/tokenInfo.entity';
import { BlockEntity } from '../entities/block.entity';
import { TxOutArchiveEntity } from '../entities/txOutArchive.entity';

require('dotenv').config();

import { initEccLib } from 'bitcoinjs-lib';
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';

initEccLib(ecc);

const RPC_URL = `http://${process.env.RPC_HOST}:${process.env.RPC_PORT}`;
const RPC_USER = process.env.RPC_USER;
const RPC_PASSWORD = process.env.RPC_PASSWORD;

let AppDataSource: DataSource;

async function initializeDataSource() {
  AppDataSource = new DataSource({
    ...ormConfig,
    entities: [
      TxOutEntity,
      PkhToAddressEntity,
      TokenMintEntity,
      TxEntity,
      TokenInfoEntity,
      BlockEntity,
      TxOutArchiveEntity,
    ],
    extra: {
      ...ormConfig.extra,
      max: 20, // 增加连接池大小
      connectionTimeoutMillis: 10000, // 连接超时时间
    },
  });
  await AppDataSource.initialize();
}

async function getRawTransaction(txid: string, retries = 3): Promise<any> {
  try {
    const response = await axios.post(
      RPC_URL,
      {
        jsonrpc: '1.0',
        id: 'curltest',
        method: 'getrawtransaction',
        params: [txid, true],
      },
      {
        auth: {
          username: RPC_USER,
          password: RPC_PASSWORD,
        },
      },
    );
    return response.data.result;
  } catch (error) {
    console.error(`Error fetching transaction ${txid}:`, error);
    if (retries > 0) {
      console.log(`Retrying in 10 seconds... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return getRawTransaction(txid, retries - 1);
    }
    return null;
  }
}

function getAddressesFromTx(tx: any): string[] {
  const addresses: string[] = [];

  if (tx.vout) {
    tx.vout.forEach((output: any) => {
      if (output.scriptPubKey && output.scriptPubKey.address) {
        addresses.push(output.scriptPubKey.address);
      }
    });
  }

  return [...new Set(addresses)];
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      console.log(`Operation failed, retrying... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay);
    } else {
      throw error;
    }
  }
}

async function fillPkhToAddress() {
  try {
    await initializeDataSource();

    const txOutRepository = AppDataSource.manager.getRepository(TxOutEntity);
    const pkhToAddressRepository =
      AppDataSource.manager.getRepository(PkhToAddressEntity);

    const batchSize = 1000;
    let processedCount = 0;
    let hasMore = true;

    while (hasMore) {
      const uniquePkhs = await retryOperation(() =>
        txOutRepository
          .createQueryBuilder('txOut')
          .select('DISTINCT txOut.ownerPkh', 'ownerPkh')
          .where('txOut.ownerPkh IS NOT NULL')
          .andWhere((qb) => {
            const subQuery = qb
              .subQuery()
              .select('owner_pkh')
              .from(PkhToAddressEntity, 'pkhToAddress')
              .getQuery();
            return 'txOut.ownerPkh NOT IN ' + subQuery;
          })
          .limit(batchSize)
          .getRawMany(),
      );

      console.log(`Found ${uniquePkhs.length} unique PKHs to process`);

      if (uniquePkhs.length === 0) {
        hasMore = false;
        break;
      }

      const pkhsToProcess = uniquePkhs.map((u) => u.ownerPkh);

      const txOuts = await retryOperation(() =>
        txOutRepository.find({
          where: { ownerPkh: In(pkhsToProcess) },
          select: ['txid', 'ownerPkh'],
        }),
      );

      console.log(`Found ${txOuts.length} txOuts for the unique PKHs`);

      const pkhToTxidMap = new Map(txOuts.map((to) => [to.ownerPkh, to.txid]));

      const pkhToAddressMappings: PkhToAddressEntity[] = [];

      for (const pkh of pkhsToProcess) {
        const txid = pkhToTxidMap.get(pkh);
        if (txid) {
          const txInfo = await getRawTransaction(txid);
          if (txInfo) {
            const addresses = getAddressesFromTx(txInfo);
            console.log(`Found ${addresses.length} addresses for txid ${txid}`);
            for (const address of addresses) {
              const calculatedPkh = ownerAddressToPubKeyHash(address);
              console.log(
                `Calculated PKH ${calculatedPkh} for address ${address}`,
              );
              if (calculatedPkh === pkh) {
                pkhToAddressMappings.push({
                  ownerPkh: pkh,
                  ownerAddress: address,
                });
                console.log(`Matched PKH ${pkh} to address ${address}`);
                break;
              }
            }
          } else {
            console.log(`Failed to get raw transaction for txid ${txid}`);
          }
        } else {
          console.log(`No txid found for PKH ${pkh}`);
        }
      }

      console.log(`Prepared ${pkhToAddressMappings.length} mappings to save`);

      if (pkhToAddressMappings.length > 0) {
        await retryOperation(() =>
          pkhToAddressRepository.save(pkhToAddressMappings),
        );
        console.log(
          `Successfully saved ${pkhToAddressMappings.length} mappings`,
        );
      }

      processedCount += pkhsToProcess.length;
      console.log(`Processed ${processedCount} unique owner_pkh values`);

      // Add a small delay to avoid overloading the database
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log('Finished filling pkh_to_address table');
  } catch (error) {
    console.error('Error in fillPkhToAddress:', error);
  } finally {
    if (AppDataSource && AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

fillPkhToAddress().catch(console.error);
