import React, { createContext, useContext } from 'react'

const WalletContext = createContext()

export const WalletProvider = ({ children, value }) => {
  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

export const useWallet = () => {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}