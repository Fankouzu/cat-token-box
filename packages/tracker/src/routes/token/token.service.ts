import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  addressToXOnlyPubKey,
  ownerAddressToPubKeyHash,
  xOnlyPubKeyToAddress,
} from '../../common/utils';
import { TxOutEntity } from '../../entities/txOut.entity';
import { Constants } from '../../common/constants';
import { LRUCache } from 'lru-cache';
import { TxEntity } from '../../entities/tx.entity';
import { CommonService } from '../../services/common/common.service';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
import { FindOptionsWhere } from 'typeorm';

@Injectable()
export class TokenService {
  private static readonly stateHashesCache = new LRUCache<string, string[]>({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly tokenInfoCache = new LRUCache<
    string,
    TokenInfoEntity
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private readonly commonService: CommonService,
    @InjectRepository(TokenInfoEntity)
    private readonly tokenInfoRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
    @InjectRepository(TxEntity)
    private readonly txRepository: Repository<TxEntity>,
    @InjectRepository(TokenMintEntity)
    private readonly tokenMintRepository: Repository<TokenMintEntity>,
  ) {
    this.checkDatabaseAndTable();
  }

  async getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr: string) {
    let cached = TokenService.tokenInfoCache.get(tokenIdOrTokenAddr);
    if (!cached) {
      let where;
      if (tokenIdOrTokenAddr.includes('_')) {
        where = { tokenId: tokenIdOrTokenAddr };
      } else {
        const tokenPubKey = addressToXOnlyPubKey(tokenIdOrTokenAddr);
        if (!tokenPubKey) {
          return null;
        }
        where = { tokenPubKey };
      }
      const tokenInfo = await this.tokenInfoRepository.findOne({
        where,
      });
      if (tokenInfo && tokenInfo.tokenPubKey) {
        const lastProcessedHeight =
          await this.commonService.getLastProcessedBlockHeight();
        if (
          lastProcessedHeight !== null &&
          lastProcessedHeight - tokenInfo.revealHeight >=
            Constants.TOKEN_INFO_CACHE_BLOCKS_THRESHOLD
        ) {
          TokenService.tokenInfoCache.set(tokenIdOrTokenAddr, tokenInfo);
        }
      }
      cached = tokenInfo;
    }

    if (cached) {
      try {
        const [mintedResult, holderResult] = await Promise.all([
          this.tokenMintRepository.query(
            'SELECT SUM(token_amount) as total FROM token_mint WHERE token_pubkey = $1',
            [cached.tokenPubKey],
          ),
          this.tokenMintRepository.query(
            'SELECT COUNT(DISTINCT owner_pkh) as count FROM token_mint WHERE token_pubkey = $1',
            [cached.tokenPubKey],
          ),
        ]);

        const mintedAmount = mintedResult[0]?.total;
        const holderCount = holderResult[0]?.count;

        cached = {
          ...cached,
          minted: mintedAmount ? BigInt(mintedAmount).toString() : '0',
          holder: holderCount ? parseInt(holderCount) : 0,
        } as TokenInfoEntity & { minted: string; holder: number };
      } catch (error) {
        console.error('Error querying token_mint table:', error);
        // 如果查询失败，我们仍然返回cached，但不包含minted和holder信息
      }
    }

    return this.renderTokenInfo(cached);
  }

  renderTokenInfo(
    tokenInfo: TokenInfoEntity & { minted?: string; holder?: number },
  ) {
    if (!tokenInfo) {
      return null;
    }
    const minterAddr = xOnlyPubKeyToAddress(tokenInfo.minterPubKey);
    const tokenAddr = xOnlyPubKeyToAddress(tokenInfo.tokenPubKey);
    const rendered = Object.assign(
      {},
      {
        minterAddr,
        tokenAddr,
        info: tokenInfo.rawInfo,
        minted: tokenInfo.minted,
        holder: tokenInfo.holder,
      },
      tokenInfo,
    );
    delete rendered.rawInfo;
    delete rendered.createdAt;
    delete rendered.updatedAt;
    return rendered;
  }

  async getTokenUtxosByOwnerAddress(
    tokenIdOrTokenAddr: string,
    ownerAddr: string,
    offset: number,
    limit: number,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    let utxos = [];
    if (tokenInfo) {
      utxos = await this.queryTokenUtxosByOwnerAddress(
        lastProcessedHeight,
        ownerAddr,
        tokenInfo,
        offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
        Math.min(
          limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
          Constants.QUERY_PAGING_MAX_LIMIT,
        ),
      );
    }
    return {
      utxos: await this.renderUtxos(utxos),
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async getTokenBalanceByOwnerAddress(
    tokenIdOrTokenAddr: string,
    ownerAddr: string,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    let utxos = [];
    if (tokenInfo) {
      utxos = await this.queryTokenUtxosByOwnerAddress(
        lastProcessedHeight,
        ownerAddr,
        tokenInfo,
      );
    }
    let confirmed = '0';
    if (tokenInfo?.tokenPubKey) {
      const tokenBalances = this.groupTokenBalances(utxos);
      confirmed = tokenBalances[tokenInfo.tokenPubKey]?.toString() || '0';
    }
    return {
      tokenId: tokenInfo?.tokenId || null,
      confirmed,
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async queryTokenUtxosByOwnerAddress(
    lastProcessedHeight: number,
    ownerAddr: string,
    tokenInfo: TokenInfoEntity = null,
    offset: number = null,
    limit: number = null,
  ) {
    const ownerPubKeyHash = ownerAddressToPubKeyHash(ownerAddr);
    if (
      lastProcessedHeight === null ||
      (tokenInfo && !tokenInfo.tokenPubKey) ||
      !ownerPubKeyHash
    ) {
      return [];
    }
    const where: FindOptionsWhere<TxOutEntity> = {
      ownerPkh: ownerPubKeyHash,
      spendTxid: IsNull(),
      blockHeight: LessThanOrEqual(lastProcessedHeight),
    };
    if (tokenInfo) {
      where.xonlyPubkey = tokenInfo.tokenPubKey;
    }
    return this.txOutRepository.find({
      where,
      order: { tokenAmount: 'DESC' },
      skip: offset,
      take: limit,
    });
  }

  async queryStateHashes(txid: string) {
    let cached = TokenService.stateHashesCache.get(txid);
    if (!cached) {
      const tx = await this.txRepository.findOne({
        select: ['stateHashes'],
        where: { txid },
      });
      cached = tx.stateHashes.split(';').slice(1);
      if (cached.length < Constants.CONTRACT_OUTPUT_MAX_COUNT) {
        cached = cached.concat(
          Array(Constants.CONTRACT_OUTPUT_MAX_COUNT - cached.length).fill(''),
        );
      }
      TokenService.stateHashesCache.set(txid, cached);
    }
    return cached;
  }

  async renderUtxos(utxos: TxOutEntity[]) {
    const renderedUtxos = [];
    for (const utxo of utxos) {
      const txoStateHashes = await this.queryStateHashes(utxo.txid);
      const renderedUtxo = {
        utxo: {
          txId: utxo.txid,
          outputIndex: utxo.outputIndex,
          script: utxo.lockingScript,
          satoshis: utxo.satoshis,
        },
        txoStateHashes,
      };
      if (utxo.ownerPkh !== null && utxo.tokenAmount !== null) {
        Object.assign(renderedUtxo, {
          state: {
            address: utxo.ownerPkh,
            amount: utxo.tokenAmount,
          },
        });
      }
      renderedUtxos.push(renderedUtxo);
    }
    return renderedUtxos;
  }

  /**
   * @param utxos utxos with the same owner address
   * @returns token balances grouped by xonlyPubkey
   */
  groupTokenBalances(utxos: TxOutEntity[]) {
    const balances = {};
    for (const utxo of utxos) {
      balances[utxo.xonlyPubkey] =
        (balances[utxo.xonlyPubkey] || 0n) + BigInt(utxo.tokenAmount);
    }
    return balances;
  }

  async checkDatabaseAndTable() {
    try {
      // 检查数据库连接
      await this.tokenMintRepository.query('SELECT 1');
      // console.log('Database connection successful');

      // 检查token_mint表是否存在
      const tableExists = await this.tokenMintRepository.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'token_mint'
        )
      `);

      if (tableExists[0].exists) {
        // console.log('token_mint table exists');
      } else {
        console.error('token_mint table does not exist');
      }

      // 检查表结构
      const columns = await this.tokenMintRepository.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'token_mint'
      `);
      // console.log('token_mint table structure:', columns);
    } catch (error) {
      console.error('Error checking database and table:', error);
    }
  }

  async getHolderListByTokenIdOrTokenAddress(tokenIdOrTokenAddr: string) {
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    if (!tokenInfo || !tokenInfo.tokenPubKey) {
      return null;
    }

    const query = `
      SELECT 
        "owner_pkh" as address, 
        SUM("token_amount") as balance, 
        COUNT(*) as "utxoCount"
      FROM 
        tx_out
      WHERE 
        "xonly_pubkey" = $1 
        AND "spend_txid" IS NULL
      GROUP BY 
        "owner_pkh"
      ORDER BY 
        balance DESC
    `;

    const holders = await this.txOutRepository.query(query, [
      tokenInfo.tokenPubKey,
    ]);

    return holders.map((holder) => ({
      address: holder.address,
      balance: holder.balance,
      utxoCount: parseInt(holder.utxoCount),
    }));
  }
}
