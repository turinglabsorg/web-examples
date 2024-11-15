import { Col, Grid, Row, Text, styled } from '@nextui-org/react'
import { useCallback, useMemo, useState } from 'react'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { SignClientTypes } from '@walletconnect/types'
import DoneIcon from '@mui/icons-material/Done'
import CloseIcon from '@mui/icons-material/Close'
import ModalStore from '@/store/ModalStore'
import { eip155Addresses } from '@/utils/EIP155WalletUtil'
import { styledToast } from '@/utils/HelperUtil'
import { walletkit } from '@/utils/WalletConnectUtil'
import { EIP155_CHAINS, EIP155_SIGNING_METHODS } from '@/data/EIP155Data'
import ChainDataMini from '@/components/ChainDataMini'
import ChainAddressMini from '@/components/ChainAddressMini'
import { getChainData } from '@/data/chainsUtil'
import RequestModal from '../components/RequestModal'
import ChainSmartAddressMini from '@/components/ChainSmartAddressMini'
import { useSnapshot } from 'valtio'
import SettingsStore from '@/store/SettingsStore'
import usePriorityAccounts from '@/hooks/usePriorityAccounts'
import useSmartAccounts from '@/hooks/useSmartAccounts'
import { EIP5792_METHODS } from '@/data/EIP5792Data'
import { getWalletCapabilities } from '@/utils/EIP5792WalletUtil'
import { EIP7715_METHOD } from '@/data/EIP7715Data'
import { useRouter } from 'next/router'

const StyledText = styled(Text, {
  fontWeight: 400
} as any)

const StyledSpan = styled('span', {
  fontWeight: 400
} as any)

export default function SessionProposalModal() {
  const { smartAccountEnabled } = useSnapshot(SettingsStore.state)
  // Get proposal data and wallet address from store
  const data = useSnapshot(ModalStore.state)
  const proposal = data?.data?.proposal as SignClientTypes.EventArguments['session_proposal']
  const [isLoadingApprove, setIsLoadingApprove] = useState(false)
  const [isLoadingReject, setIsLoadingReject] = useState(false)
  const { getAvailableSmartAccountsOnNamespaceChains } = useSmartAccounts()

  const { query } = useRouter()

  const addressesToApprove = Number(query.addressesToApprove) || null

  const supportedNamespaces = useMemo(() => {
    // eip155
    const eip155Chains = Object.keys(EIP155_CHAINS)
    const eip155Methods = Object.values(EIP155_SIGNING_METHODS)

    //eip5792
    const eip5792Chains = Object.keys(EIP155_CHAINS)
    const eip5792Methods = Object.values(EIP5792_METHODS)

    //eip7715
    const eip7715Chains = Object.keys(EIP155_CHAINS)
    const eip7715Methods = Object.values(EIP7715_METHOD)
    

    return {
      eip155: {
        chains: eip155Chains,
        methods: eip155Methods.concat(eip5792Methods).concat(eip7715Methods),
        events: ['accountsChanged', 'chainChanged'],
        accounts: eip155Chains
          .map(chain =>
            eip155Addresses
              .map(account => `${chain}:${account}`)
              .slice(0, addressesToApprove ?? eip155Addresses.length)
          )
          .flat()
      }
    }
  }, [addressesToApprove])
  console.log('supportedNamespaces', supportedNamespaces, eip155Addresses)

  const requestedChains = useMemo(() => {
    if (!proposal) return []
    const required = []
    for (const [key, values] of Object.entries(proposal.params.requiredNamespaces)) {
      const chains = key.includes(':') ? key : values.chains
      required.push(chains)
    }

    const optional = []
    for (const [key, values] of Object.entries(proposal.params.optionalNamespaces)) {
      const chains = key.includes(':') ? key : values.chains
      optional.push(chains)
    }
    console.log('requestedChains', [...new Set([...required.flat(), ...optional.flat()])])

    return [...new Set([...required.flat(), ...optional.flat()])]
  }, [proposal])

  // the chains that are supported by the wallet from the proposal
  const supportedChains = useMemo(
    () =>
      requestedChains
        .map(chain => {
          const chainData = getChainData(chain!)

          if (!chainData) return null

          return chainData
        })
        .filter(chain => chain), // removes null values
    [requestedChains]
  )

  // get required chains that are not supported by the wallet
  const notSupportedChains = useMemo(() => {
    if (!proposal) return []
    const required = []
    for (const [key, values] of Object.entries(proposal.params.requiredNamespaces)) {
      const chains = key.includes(':') ? key : values.chains
      required.push(chains)
    }
    return required
      .flat()
      .filter(
        chain =>
          !supportedChains
            .map(supportedChain => `${supportedChain?.namespace}:${supportedChain?.chainId}`)
            .includes(chain!)
      )
  }, [proposal, supportedChains])
  console.log('notSupportedChains', { notSupportedChains, supportedChains })
  const getAddress = useCallback((namespace?: string) => {
    console.log('getAddress', namespace)
    if (!namespace) return 'N/A'
    switch (namespace) {
      case 'eip155':
        return eip155Addresses[0]
    }
  }, [])

  const namespaces = useMemo(() => {
    try {
      // the builder throws an exception if required namespaces are not supported
      return buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces
      })
    } catch (e) {
      console.error('Error building approved namespaces', e)
    }
  }, [proposal.params, supportedNamespaces])

  const reorderedEip155Accounts = usePriorityAccounts({ namespaces })
  console.log('Reordered accounts', { reorderedEip155Accounts })

  // Hanlde approve action, construct session namespace
  const onApprove = useCallback(async () => {
    console.log('onApprove', { proposal, namespaces })
    try {
      if (proposal && namespaces) {
        setIsLoadingApprove(true)
        if (reorderedEip155Accounts.length > 0) {
          // we should append the smart accounts to the available eip155 accounts
          namespaces.eip155.accounts = reorderedEip155Accounts.concat(namespaces.eip155.accounts)
        }
        //get capabilities for all reorderedEip155Accounts in wallet
        const capabilities = getWalletCapabilities(reorderedEip155Accounts)
        let sessionProperties = {
          capabilities: JSON.stringify(capabilities)
        } as any
        console.log('sessionProperties', sessionProperties)
        await walletkit.approveSession({
          id: proposal.id,
          namespaces,
          sessionProperties
        })
        SettingsStore.setSessions(Object.values(walletkit.getActiveSessions()))
      }
    } catch (e) {
      styledToast((e as Error).message, 'error')
    } finally {
      setIsLoadingApprove(false)
      ModalStore.close()
    }
  }, [namespaces, proposal, reorderedEip155Accounts])

  // Hanlde reject action
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const onReject = useCallback(async () => {
    if (proposal) {
      try {
        setIsLoadingReject(true)
        await new Promise(resolve => setTimeout(resolve, 1000))
        await walletkit.rejectSession({
          id: proposal.id,
          reason: getSdkError('USER_REJECTED_METHODS')
        })
      } catch (e) {
        setIsLoadingReject(false)
        styledToast((e as Error).message, 'error')
        return
      }
    }
    setIsLoadingReject(false)
    ModalStore.close()
  }, [proposal])
  console.log('notSupportedChains', notSupportedChains)
  console.log('supportedChains', supportedChains)
  return (
    <RequestModal
      metadata={proposal.params.proposer.metadata}
      onApprove={onApprove}
      onReject={onReject}
      approveLoader={{ active: isLoadingApprove }}
      rejectLoader={{ active: isLoadingReject }}
      infoBoxCondition={notSupportedChains.length > 0 || supportedChains.length === 0}
      disableApprove={notSupportedChains.length > 0 || supportedChains.length === 0}
      infoBoxText={`The session cannot be approved because the wallet does not the support some or all of the proposed chains. Please inspect the console for more information.`}
    >
      <Row>
        <Col>
          <StyledText h4>Requested permissions</StyledText>
        </Col>
      </Row>
      <Row>
        <Col>
          <DoneIcon style={{ verticalAlign: 'bottom' }} />{' '}
          <StyledSpan>View your balance and activity</StyledSpan>
        </Col>
      </Row>
      <Row>
        <Col>
          <DoneIcon style={{ verticalAlign: 'bottom' }} />{' '}
          <StyledSpan>Send approval requests</StyledSpan>
        </Col>
      </Row>
      <Row>
        <Col style={{ color: 'gray' }}>
          <CloseIcon style={{ verticalAlign: 'bottom' }} />
          <StyledSpan>Move funds without permission</StyledSpan>
        </Col>
      </Row>
      <Grid.Container style={{ marginBottom: '10px', marginTop: '10px' }} justify={'space-between'}>
        <Grid>
          <Row style={{ color: 'GrayText' }}>Accounts</Row>
          {(supportedChains.length > 0 &&
            supportedChains.map((chain, i) => {
              return (
                <Row key={i}>
                  <ChainAddressMini key={i} address={getAddress(chain?.namespace) || 'test'} />
                </Row>
              )
            })) || <Row>Non available</Row>}

          <Row style={{ color: 'GrayText' }}>Smart Accounts</Row>
          {smartAccountEnabled &&
            namespaces &&
            getAvailableSmartAccountsOnNamespaceChains(namespaces?.eip155?.chains).map(
              (account, i) => {
                if (!account) {
                  return <></>
                }
                return (
                  <Row key={i}>
                    <ChainSmartAddressMini account={account} />
                  </Row>
                )
              }
            )}
        </Grid>
        <Grid>
          <Row style={{ color: 'GrayText' }} justify="flex-end">
            Chains
          </Row>
          {(supportedChains.length > 0 &&
            supportedChains.map((chain, i) => {
              console.log('chain', chain)
              if (!chain) {
                return <></>
              }

              return (
                <Row key={i}>
                  <ChainDataMini key={i} chainId={`${chain?.namespace}:${chain?.chainId}`} />
                </Row>
              )
            })) || <Row>Non available</Row>}
          <Row style={{ color: 'GrayText' }} justify="flex-end">
            Chains
          </Row>
          {smartAccountEnabled &&
            namespaces &&
            getAvailableSmartAccountsOnNamespaceChains(namespaces?.eip155?.chains).map(
              ({ chain }, i) => {
                if (!chain) {
                  return <></>
                }
                return (
                  <Row key={i} style={{ marginTop: '24px' }}>
                    <ChainDataMini key={i} chainId={`eip155:${chain.id}`} />
                  </Row>
                )
              }
            )}
        </Grid>
      </Grid.Container>
    </RequestModal>
  )
}
