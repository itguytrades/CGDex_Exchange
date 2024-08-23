// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0; 

import "hardhat/console.sol";

contract Token {
	string public name;
	string public symbol;
	uint256 public decimals = 18;
	uint256 public totalSupply;

	// Track Balances

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	event Transfer(
		address indexed from, 
		address indexed to, 
		uint256 value
		);

		event Approval(
		address indexed owner,
		address indexed spender,  
		uint256 value
		);

	// Send Tokes

	constructor(
		string memory _name, 
		string memory _symbol, 
		uint256  _totalSupply
		) 
	{
		name = _name;
		symbol = _symbol;
		totalSupply = _totalSupply * (10**decimals);
		balanceOf[msg.sender] = totalSupply;
	}

	function transfer(address _to, uint256 _value) 
		public 
		returns (bool success) {
		
		// require enough tokens to send
		require(balanceOf[msg.sender] >= _value);
		require(_to != address(0));

		// Deduct tokens from sender
		balanceOf[msg.sender] = balanceOf[msg.sender] - _value;
		// Credit tokens to receiver
		balanceOf[_to] = balanceOf[_to] + _value;
		emit Transfer(msg.sender, _to, _value);
		return true;

	}


	function approve(address _spender, uint256 _value) 
		public 
		returns (bool success)
		
	{
		require(_spender != address(0));
		allowance[msg.sender][_spender] = _value;
		emit Approval(msg.sender, _spender, _value);
		return true;
	}

}







/*
Methods
function name() public view returns (string)
function symbol() public view returns (string)
function decimals() public view returns (uint8)
function totalSupply() public view returns (uint256)
function balanceOf(address _owner) public view returns (uint256 balance)
function transfer(address _to, uint256 _value) public returns (bool success)
function transferFrom(address _from, address _to, uint256 _value) public returns (bool success)
function approve(address _spender, uint256 _value) public returns (bool success)
function allowance(address _owner, address _spender) public view returns (uint256 remaining)

Events
event Transfer(address indexed _from, address indexed _to, uint256 _value)
event Approval(address indexed _owner, address indexed _spender, uint256 _value)

*/